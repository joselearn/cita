import { type Control, saveControl } from "./control.js";
import type { State } from "./dedup.js";
import { broadcast } from "./telegram.js";
import { getNotifyChannels } from "./config.js";
import { todayKey, localHourMinute, formatDateTime, dateInRange } from "./time.js";
import { loadEvents, computeStats, yesterdayLine } from "./events.js";

/**
 * Avisos "de sistema" del bot: fallos, latido diario y expiracion de la busqueda.
 * Solo se mandan por Telegram (el correo es para las citas).
 */

/** Fallos consecutivos antes de avisar que DEKRA no responde. */
const FAIL_ALERT_THRESHOLD = Number(process.env.FAIL_ALERT_THRESHOLD) || 5;

/** Hora local (0-23) del latido diario. -1 lo desactiva. */
const HEARTBEAT_HOUR = Number(process.env.HEARTBEAT_HOUR ?? 7);

function telegramEnabled(): boolean {
  try {
    return getNotifyChannels().includes("telegram");
  } catch {
    return false;
  }
}

async function notifySystem(text: string): Promise<void> {
  if (!telegramEnabled()) return;
  const errors = await broadcast(text);
  if (errors.length > 0) console.error("No se pudo mandar aviso de sistema:", errors.join(" | "));
}

/** True si ahora mismo estamos en horas de silencio. */
export function inQuietHours(control: Control, now = new Date()): boolean {
  return control.quiet ? dateInRange(now, control.quiet) : false;
}

/**
 * Registra el resultado de la corrida: si hubo fallos, cuenta; si no, resetea.
 * Avisa una vez al llegar al umbral y otra al recuperarse.
 */
export async function trackFailures(state: State, errors: string[]): Promise<void> {
  if (errors.length > 0) {
    state.failures.count += 1;
    state.failures.lastError = errors[0].slice(0, 200);
    state.failures.lastErrorAt = new Date().toISOString();
    if (state.failures.count >= FAIL_ALERT_THRESHOLD && !state.failures.alerted) {
      state.failures.alerted = true;
      await notifySystem(
        `⚠️ <b>DEKRA no responde</b> desde hace ${state.failures.count} revisiones seguidas.\n` +
          `Ultimo error: ${state.failures.lastError}\n` +
          `Sigo intentando cada minuto y te aviso cuando vuelva.`,
      );
    }
    return;
  }
  if (state.failures.alerted) {
    await notifySystem(`✅ <b>DEKRA volvio a responder.</b> La busqueda sigue normal.`);
  }
  state.failures = { count: 0, alerted: false };
}

/**
 * Latido diario: un mensaje corto a la hora configurada confirmando que sigue
 * buscando. Solo si esta activo y no estamos en silencio.
 */
export async function maybeHeartbeat(state: State, control: Control, summary: string, now = new Date()): Promise<void> {
  if (HEARTBEAT_HOUR < 0 || !control.active || inQuietHours(control, now)) return;
  const today = todayKey(now);
  if (state.lastHeartbeatDate === today) return;
  if (localHourMinute(now).hour < HEARTBEAT_HOUR) return;
  state.lastHeartbeatDate = today;
  let ayer = "";
  try {
    ayer = `\n${yesterdayLine(computeStats(await loadEvents(), 2, now))}`;
  } catch {
    // Si falla el historial, el latido sale igual.
  }
  await notifySystem(`☀️ Sigo buscando. ${summary}${ayer}\nManda /parar si ya no lo necesitas.`);
}

/**
 * Expiracion automatica: avisa un dia antes y apaga la busqueda al vencer.
 * Devuelve true si la busqueda quedo apagada.
 */
export async function checkExpiry(control: Control, now = new Date()): Promise<boolean> {
  if (!control.active || !control.expiresAt) return false;
  const expires = new Date(control.expiresAt).getTime();
  if (now.getTime() >= expires) {
    control.active = false;
    await saveControl(control);
    await notifySystem(
      `⏹ <b>Busqueda terminada:</b> llevaba el maximo de dias sin que la pararas.\n` +
        `Si todavia necesitas cita, manda /buscar y la retomo.`,
    );
    return true;
  }
  if (!control.expiryWarned && expires - now.getTime() <= 86_400_000) {
    control.expiryWarned = true;
    await saveControl(control);
    await notifySystem(
      `⏳ La busqueda se apaga sola el ${formatDateTime(control.expiresAt)}. ` +
        `Manda /buscar para renovarla otros dias, o /parar si ya no la necesitas.`,
    );
  }
  return false;
}
