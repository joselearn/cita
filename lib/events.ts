import { appendList, readList } from "./store.js";
import { localHourMinute, todayKey, TIME_ZONE } from "./time.js";

/**
 * Historial de novedades: a que hora aparecen cupos y cuanto duran.
 * Vive en una lista aparte del estado principal ("events"), que solo se toca
 * cuando hay algo que anotar (unas pocas veces al dia).
 */

export interface SlotEvent {
  /** Instante (ISO). */
  t: string;
  /** "new": aparecio un dia con cupos. "gone": ese dia dejo de tener cupos. */
  kind: "new" | "gone";
  /** Nombre de la estacion. */
  loc: string;
  locId: string;
  /** Fecha del cupo (YYYY-MM-DD). */
  date: string;
  /** Cuantos horarios tenia al aparecer (0 en "gone"). */
  n: number;
}

const EVENTS_KEY = "events";
const MAX_EVENTS = Number(process.env.MAX_EVENTS) || 2000;

/** Un "cupo suelto" (cancelacion) tiene pocos horarios; una apertura de agenda, muchos. */
const LOOSE_MAX_TIMES = Number(process.env.LOOSE_MAX_TIMES) || 5;

export async function recordEvents(events: SlotEvent[]): Promise<void> {
  await appendList(EVENTS_KEY, events, MAX_EVENTS);
}

export async function loadEvents(): Promise<SlotEvent[]> {
  return readList<SlotEvent>(EVENTS_KEY);
}

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function localWeekday(date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function bar(n: number, max: number, width = 10): string {
  const len = max > 0 ? Math.round((n / max) * width) : 0;
  return "▇".repeat(Math.max(len, n > 0 ? 1 : 0));
}

/** Franjas de horas contiguas con mas actividad, ej. "6 a 8 am y 4 pm". */
function bestHours(byHour: number[]): string {
  const max = Math.max(...byHour);
  if (max === 0) return "";
  const hot = byHour.map((n) => n >= max * 0.5);
  const ranges: [number, number][] = [];
  for (let h = 0; h < 24; h++) {
    if (!hot[h]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === h - 1) last[1] = h;
    else ranges.push([h, h]);
  }
  const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
  return ranges
    .slice(0, 3)
    .map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)} a ${fmt(b + 1)}`))
    .join(", ");
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 24) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} dias`;
}

export interface EventStats {
  total: number;
  loose: number;
  openings: number;
  byHour: number[];
  byHourLoose: number[];
  byWeekday: number[];
  /** Duracion (min) de cada cupo suelto que ya se ocupo. */
  looseLifetimes: number[];
  /** Apariciones de ayer (hora local). */
  yesterday: SlotEvent[];
  byLocation: Record<string, number>;
}

/** Calcula estadisticas de los ultimos `days` dias. */
export function computeStats(events: SlotEvent[], days = 30, now = new Date()): EventStats {
  const since = now.getTime() - days * 86_400_000;
  const recent = events.filter((e) => new Date(e.t).getTime() >= since);
  const news = recent.filter((e) => e.kind === "new");

  const stats: EventStats = {
    total: news.length,
    loose: 0,
    openings: 0,
    byHour: new Array(24).fill(0),
    byHourLoose: new Array(24).fill(0),
    byWeekday: new Array(7).fill(0),
    looseLifetimes: [],
    yesterday: [],
    byLocation: {},
  };

  const yesterdayKey = todayKey(new Date(now.getTime() - 86_400_000));
  // Para medir cuanto dura un cupo: primer "gone" posterior de la misma estacion+fecha.
  const gones = recent.filter((e) => e.kind === "gone");

  for (const e of news) {
    const d = new Date(e.t);
    const h = localHourMinute(d).hour;
    stats.byHour[h]++;
    stats.byWeekday[localWeekday(d)]++;
    stats.byLocation[e.loc] = (stats.byLocation[e.loc] ?? 0) + 1;
    if (todayKey(d) === yesterdayKey) stats.yesterday.push(e);

    const isLoose = e.n <= LOOSE_MAX_TIMES;
    if (isLoose) {
      stats.loose++;
      stats.byHourLoose[h]++;
      const gone = gones.find((g) => g.locId === e.locId && g.date === e.date && g.t > e.t);
      if (gone) {
        const mins = (new Date(gone.t).getTime() - d.getTime()) / 60_000;
        if (mins <= 2 * 1440) stats.looseLifetimes.push(mins);
      }
    } else {
      stats.openings++;
    }
  }
  return stats;
}

/** Resumen en HTML de Telegram para /horas. */
export function formatStats(stats: EventStats, days = 30): string {
  if (stats.total === 0) {
    return (
      `📊 Todavia no hay novedades registradas en los ultimos ${days} dias.\n` +
      `Cada vez que aparezca un cupo lo anoto; en una o dos semanas aqui veras a que horas suelen salir.`
    );
  }
  const lines: string[] = [`📊 <b>Novedades de los ultimos ${days} dias: ${stats.total}</b>`];
  lines.push(`Cupos sueltos (≤${LOOSE_MAX_TIMES} horarios): ${stats.loose} · Aperturas grandes: ${stats.openings}`);

  const max = Math.max(...stats.byHour);
  lines.push("", "<b>Por hora del dia</b>");
  for (let h = 0; h < 24; h++) {
    if (stats.byHour[h] === 0) continue;
    lines.push(`<code>${String(h).padStart(2)}h ${bar(stats.byHour[h], max).padEnd(10)} ${stats.byHour[h]}</code>`);
  }
  const best = bestHours(stats.byHour);
  if (best) lines.push(`Mejores horas: <b>${best}</b>`);
  const bestLoose = bestHours(stats.byHourLoose);
  if (stats.loose > 0 && bestLoose && bestLoose !== best) lines.push(`Cupos sueltos sobre todo: ${bestLoose}`);

  lines.push("", "<b>Por dia de la semana</b>");
  lines.push(`<code>${[1, 2, 3, 4, 5, 6, 0].map((d) => `${WEEKDAYS[d]} ${stats.byWeekday[d]}`).join("  ")}</code>`);

  if (stats.looseLifetimes.length > 0) {
    const med = median(stats.looseLifetimes);
    const under3 = Math.round((stats.looseLifetimes.filter((m) => m <= 3).length / stats.looseLifetimes.length) * 100);
    lines.push(
      "",
      `⏱ Los cupos sueltos duran en promedio <b>${fmtMinutes(med)}</b>; el ${under3}% se ocupa en 3 min o menos (${stats.looseLifetimes.length} medidos).`,
    );
  }

  const locs = Object.entries(stats.byLocation).sort((a, b) => b[1] - a[1]);
  if (locs.length > 1) {
    lines.push("", `<b>Por estacion:</b> ${locs.map(([n, c]) => `${n} ${c}`).join(" · ")}`);
  }
  if (stats.total < 10) lines.push("", "Pocos datos todavia; el patron se aclara con mas dias.");
  return lines.join("\n");
}

/** Linea corta para el latido diario: que paso ayer. */
export function yesterdayLine(stats: EventStats): string {
  const y = stats.yesterday;
  if (y.length === 0) return "Ayer no aparecio ningun cupo nuevo.";
  const hours = y.map((e) => localHourMinute(new Date(e.t)).hour);
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
  const when = lo === hi ? `cerca de las ${fmt(lo)}` : `entre ${fmt(lo)} y ${fmt(hi + 1)}`;
  return `Ayer aparecieron ${y.length} cupo(s) nuevo(s), ${when}. Manda /horas para ver el patron.`;
}
