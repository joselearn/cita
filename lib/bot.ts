import { getTelegramConfig } from "./config.js";
import { handleCommand, handleCallback } from "./commands.js";
import { sendTelegramMessage, editTelegramMessage, answerCallback } from "./telegram.js";

/**
 * Procesa una actualizacion de Telegram (mensaje o boton) de punta a punta.
 * Lo usan el webhook (api/telegram.ts) y el modo polling (scripts/bot-poll.ts).
 */

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id?: number; first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; username?: string };
    message?: { chat: { id: number }; message_id: number };
  };
}

export type UpdateOutcome = "ignored" | "unauthorized" | "command" | "callback" | "error";

function isAuthorized(chatId: number | string): boolean {
  return getTelegramConfig().chatIds.includes(String(chatId));
}

export async function processUpdate(update: TelegramUpdate, log: (line: string) => void = console.log): Promise<UpdateOutcome> {
  // --- Boton pulsado ---
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    if (!isAuthorized(chatId)) {
      await answerCallback(cq.id, "No estas autorizado.");
      return "unauthorized";
    }
    try {
      const result = await handleCallback(cq.data ?? "");
      await answerCallback(cq.id, result.toast);
      if (result.edit && cq.message) {
        await editTelegramMessage(chatId, cq.message.message_id, result.edit.text, result.edit.replyMarkup);
      }
      if (result.send) await sendTelegramMessage(chatId, result.send.text, result.send.replyMarkup);
      log(`[bot] ${chatId} boton ${cq.data} -> ${result.toast ?? result.edit?.text.split("\n")[0] ?? "ok"}`);
      return "callback";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[bot] error en boton ${cq.data}: ${msg}`);
      await answerCallback(cq.id, "Algo fallo, intenta de nuevo.");
      return "error";
    }
  }

  // --- Mensaje de texto ---
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim();
  if (!chatId || !text) return "ignored";

  if (!isAuthorized(chatId)) {
    log(`[bot] chat no autorizado ${chatId} (@${message?.from?.username ?? "?"}): ${text}`);
    await sendTelegramMessage(chatId, "No estas autorizado para usar este bot.").catch(() => {});
    return "unauthorized";
  }

  try {
    const reply = await handleCommand(text);
    await sendTelegramMessage(chatId, reply.text, reply.replyMarkup);
    log(`[bot] ${chatId}: ${text} -> ${reply.text.replace(/<[^>]+>/g, "").split("\n")[0]}`);
    return "command";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[bot] error procesando "${text}": ${msg}`);
    await sendTelegramMessage(chatId, `Algo fallo procesando el comando: ${msg}`).catch(() => {});
    return "error";
  }
}
