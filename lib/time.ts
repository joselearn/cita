/** Utilidades de fecha/hora en la zona horaria de Costa Rica. */

export const TIME_ZONE = process.env.TIME_ZONE?.trim() || "America/Costa_Rica";

/** Fecha de hoy (YYYY-MM-DD) en hora de Costa Rica, no en UTC. */
export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Suma `days` dias a una clave YYYY-MM-DD. */
export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Hora y minuto locales (Costa Rica) de un instante. */
export function localHourMinute(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute") };
}

/** Minutos desde medianoche, hora local. */
export function localMinutes(date: Date): number {
  const { hour, minute } = localHourMinute(date);
  return hour * 60 + minute;
}

/** Formatea una hora ISO (UTC) a hora local, ej. "6:25 a. m.". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CR", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Formatea fecha y hora local corta, ej. "29/09, 10:11 a. m.". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Rango de horas del dia. `from` y `to` son horas 0-24; puede cruzar medianoche (22-6). */
export interface HourRange {
  from: number;
  to: number;
}

/** Interpreta "6-10", "6 a 10", "22-6". Devuelve null si no es valido. */
export function parseHourRange(text: string): HourRange | null {
  const m = /^\s*(\d{1,2})\s*(?:-|a|–)\s*(\d{1,2})\s*$/i.exec(text);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from < 0 || from > 24 || to < 0 || to > 24 || from === to) return null;
  return { from, to };
}

export function formatHourRange(r: HourRange): string {
  const h = (n: number) => `${n}:00`;
  return `${h(r.from)} a ${h(r.to)}`;
}

/**
 * True si los minutos-del-dia `m` caen dentro del rango [from, to).
 * Si el rango cruza medianoche (22-6), cubre 22:00-23:59 y 0:00-5:59.
 */
export function minutesInRange(m: number, r: HourRange): boolean {
  const from = r.from * 60;
  const to = r.to * 60;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** True si el instante `date` cae en el rango horario (hora local). */
export function dateInRange(date: Date, r: HourRange): boolean {
  return minutesInRange(localMinutes(date), r);
}
