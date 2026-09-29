import { getTelegramConfig, getBookingUrl, introForMode, type NotifyMode } from "./config.js";
import type { LocationNotification } from "./email.js";
import { formatTime } from "./time.js";
import { notificationExtraRow, type InlineKeyboard, type Button } from "./keyboards.js";
import type { SentMessage } from "./dedup.js";

/** Maximo de horarios que se listan por fecha en el mensaje. */
const MAX_TIMES_PER_DATE = Number(process.env.TELEGRAM_MAX_TIMES) || 8;

/** Limite de Telegram por mensaje es 4096; se deja margen para el encabezado. */
const MAX_MESSAGE_CHARS = 3800;

/** Escapa los caracteres que Telegram interpreta como HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Llamadas a la Bot API
// ---------------------------------------------------------------------------

interface TelegramResponse<T = unknown> {
  ok: boolean;
  description?: string;
  result?: T;
}

async function callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const cfg = getTelegramConfig();
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ ok: false }))) as TelegramResponse<T>;
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method} respondio ${res.status}: ${data.description ?? "sin detalle"}`);
  }
  return data.result as T;
}

/** Envia un mensaje (HTML) y devuelve su message_id. */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<number> {
  const result = await callApi<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  return result.message_id;
}

/** Edita el texto (y botones) de un mensaje ya enviado. */
export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  try {
    await callApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    });
  } catch (err) {
    // Telegram rechaza editar si el contenido es identico; no es un error real.
    if (err instanceof Error && /message is not modified/i.test(err.message)) return;
    throw err;
  }
}

/** Responde a un boton pulsado (quita el "reloj" del boton; `toast` muestra un aviso corto). */
export async function answerCallback(callbackId: string, toast?: string): Promise<void> {
  await callApi("answerCallbackQuery", { callback_query_id: callbackId, ...(toast ? { text: toast } : {}) }).catch(
    () => {},
  );
}

/** Manda el mismo texto a todos los chats configurados; devuelve cuantos fallaron. */
export async function broadcast(text: string, replyMarkup?: InlineKeyboard): Promise<string[]> {
  const cfg = getTelegramConfig();
  const results = await Promise.allSettled(cfg.chatIds.map((id) => sendTelegramMessage(id, text, replyMarkup)));
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason?.message ?? r.reason));
}

// ---------------------------------------------------------------------------
// Avisos de citas
// ---------------------------------------------------------------------------

export function takenKey(locationId: string, date: string): string {
  return `${locationId}|${date}`;
}

/** Bloque de texto de una ubicacion; `maxTimes` limita los horarios por fecha. */
function buildLocationBlock(n: LocationNotification, maxTimes: number, taken: Set<string>): string {
  const dates = n.dates
    .map((d) => {
      if (taken.has(takenKey(n.locationId, d.date))) {
        return `  • <s>${d.date}</s> ya se ocupo`;
      }
      if (d.times.length === 0 || maxTimes === 0) {
        return `  • ${d.date}${d.times.length ? ` — ${d.times.length} cupo(s)` : ""}`;
      }
      const shown = d.times.slice(0, maxTimes).map(formatTime).join(", ");
      const extra = d.times.length > maxTimes ? "…" : "";
      return `  • ${d.date} — ${d.times.length} cupo(s): ${escapeHtml(shown)}${extra}`;
    })
    .join("\n");
  return `<b>${escapeHtml(n.locationName)}</b>\n${dates}`;
}

function header(mode: NotifyMode): string {
  return `🚗 <b>Hay citas disponibles en DEKRA</b>\n${introForMode(mode)}\n`;
}

function buttonsFor(notifications: LocationNotification[], taken: Set<string>): InlineKeyboard {
  const rows: Button[][] = notifications
    .filter((n) => n.dates.some((d) => !taken.has(takenKey(n.locationId, d.date))))
    .map((n) => [{ text: `📅 Reservar en ${n.locationName}`, url: getBookingUrl(n.locationId) }]);
  rows.push(notificationExtraRow());
  return { inline_keyboard: rows };
}

/** Arma el mensaje en formato HTML de Telegram (sin partir; util para pruebas). */
export function buildTelegramText(
  notifications: LocationNotification[],
  mode: NotifyMode = "target-dates",
  taken: Set<string> = new Set(),
): string {
  const blocks = notifications.map((n) => buildLocationBlock(n, MAX_TIMES_PER_DATE, taken));
  return `${header(mode)}\n${blocks.join("\n\n")}`;
}

export interface TelegramChunk {
  text: string;
  replyMarkup: InlineKeyboard;
  notifications: LocationNotification[];
}

/**
 * Parte el aviso en varios mensajes si no cabe en uno (Telegram admite 4096
 * caracteres). Cada mensaje lleva los botones de las ubicaciones que contiene.
 * Si una sola ubicacion no cabe, se recortan sus horarios.
 */
export function buildTelegramChunks(
  notifications: LocationNotification[],
  mode: NotifyMode = "target-dates",
  taken: Set<string> = new Set(),
): TelegramChunk[] {
  const chunks: TelegramChunk[] = [];
  let text = header(mode);
  let group: LocationNotification[] = [];

  const flush = () => {
    if (group.length === 0) return;
    chunks.push({ text, replyMarkup: buttonsFor(group, taken), notifications: group });
    text = `${header(mode)}(continuacion)\n`;
    group = [];
  };

  for (const n of notifications) {
    let block = buildLocationBlock(n, MAX_TIMES_PER_DATE, taken);
    for (const fewer of [3, 0]) {
      if (header(mode).length + block.length + 2 <= MAX_MESSAGE_CHARS) break;
      block = buildLocationBlock(n, fewer, taken);
    }
    if (text.length + block.length + 1 > MAX_MESSAGE_CHARS) flush();
    text += `\n${block}\n`;
    group.push(n);
  }
  flush();
  return chunks;
}

/**
 * Envia el aviso de citas a todos los chats configurados. Devuelve los mensajes
 * enviados, para poder tacharlos despues si un cupo se ocupa.
 */
export async function sendAvailabilityTelegram(
  notifications: LocationNotification[],
  mode: NotifyMode = "target-dates",
): Promise<SentMessage[]> {
  const cfg = getTelegramConfig();
  const chunks = buildTelegramChunks(notifications, mode);
  const sent: SentMessage[] = [];

  const results = await Promise.allSettled(
    cfg.chatIds.map(async (chatId) => {
      // Los mensajes de un mismo chat van en orden.
      for (const c of chunks) {
        const messageId = await sendTelegramMessage(chatId, c.text, c.replyMarkup);
        sent.push({
          chatId,
          messageId,
          mode,
          notifications: c.notifications,
          taken: [],
          sentAt: new Date().toISOString(),
        });
      }
    }),
  );

  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length > 0) {
    throw new Error(
      `Fallo el envio por Telegram (${failed.length}/${results.length}): ` +
        failed.map((f) => String(f.reason?.message ?? f.reason)).join(" | "),
    );
  }
  return sent;
}

/** Re-renderiza un aviso ya enviado con los cupos ocupados tachados y lo edita en Telegram. */
export async function updateSentMessage(msg: SentMessage): Promise<void> {
  const taken = new Set(msg.taken);
  const text = buildTelegramText(msg.notifications, msg.mode, taken);
  await editTelegramMessage(msg.chatId, msg.messageId, text, buttonsFor(msg.notifications, taken));
}
