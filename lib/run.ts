import { fetchAvailableDays, fetchTimeSlots, toDateKey } from "./dekra.js";
import { getTargetDates, getNotifyChannels, isVercel, type DekraLocation, type NotifyChannel, type NotifyMode } from "./config.js";
import { loadControl, resolveLocations, type Control } from "./control.js";
import { loadState, saveState, diffAvailable, acquireLock, releaseLock, dedupBackend, type State } from "./dedup.js";
import { recordEvents, type SlotEvent } from "./events.js";
import type { LocationNotification, DateSlots } from "./email.js";
import { notify } from "./notify.js";
import { trackFailures, maybeHeartbeat, checkExpiry, inQuietHours } from "./alerts.js";
import { updateSentMessage, takenKey } from "./telegram.js";
import { todayKey, addDays, dateInRange } from "./time.js";

export interface LocationResult {
  name: string;
  locationId: string;
  totalAvailableDays: number;
  earliestAvailable: string | null;
  /** Fechas con cupos reales que cumplen el criterio del modo (objetivo o ventana). */
  availableTargetDates: string[];
  /** Fechas que acaban de habilitarse, con sus horarios. */
  newlyNotified: DateSlots[];
  /** Error al consultar esta ubicacion (no se actualizo su estado). */
  error?: string;
}

export interface RunResult {
  checkedAt: string;
  mode: NotifyMode;
  targetDates: string[];
  windowDays: number;
  /** Si el bot tiene la busqueda activa. */
  active: boolean;
  locations: LocationResult[];
  /** Canales configurados (correo, Telegram o ambos). */
  channels: NotifyChannel[];
  /** Canales por los que se envio el aviso en esta corrida (vacio si no hubo novedades). */
  notifiedVia: NotifyChannel[];
  /** Avisos guardados para despues por horas de silencio. */
  deferred: number;
  /** @deprecated usa notifiedVia. Se mantiene por compatibilidad. */
  emailSent: boolean;
  dedupBackend: "upstash" | "file";
  /** True si no se consulto DEKRA: "paused" (bot en pausa) o "locked" (otra corrida en curso). */
  skipped?: "paused" | "locked";
  /** Milisegundos que tardo la corrida. */
  durationMs: number;
}

/**
 * Maximo de dias a consultar (horarios) en modo "cita mas proxima" buscando el
 * primer dia con cupos reales. Configurable con EARLIEST_SCAN_LIMIT.
 */
const EARLIEST_SCAN_LIMIT = Number(process.env.EARLIEST_SCAN_LIMIT) || 12;

/** Segundos que dura el candado anti-solapamiento (solo con Upstash). */
const LOCK_TTL_SECONDS = Number(process.env.LOCK_TTL_SECONDS) || 55;

/** Cuantas ubicaciones se consultan a la vez. */
const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY) || 4;

/** Cuantos avisos enviados se recuerdan para tacharlos, y por cuantos dias. */
const KEEP_MESSAGES = 20;
const KEEP_MESSAGE_DAYS = 3;

/** Ejecuta `fn` sobre cada item con a lo sumo `limit` en paralelo, conservando el orden. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

interface Scan {
  availableDates: string[];
  trulyAvailable: string[];
  earliestAvailable: string | null;
  slotsByDate: Map<string, string[]>;
}

/** Consulta una ubicacion: dias disponibles + horarios reales de los dias candidatos. */
async function scanLocation(
  location: DekraLocation,
  mode: NotifyMode,
  targetDates: string[],
  control: Control,
): Promise<Scan> {
  const today = todayKey();
  const windowKeys =
    mode === "window" ? Array.from({ length: control.windowDays + 1 }, (_, i) => addDays(today, i)) : [];
  const days = await fetchAvailableDays(
    location.locationId,
    mode === "window" ? { endDateKey: windowKeys[windowKeys.length - 1] } : {},
  );

  const availableDates = Array.from(new Set(days.filter((d) => d.isAvailable).map((d) => toDateKey(d.date)))).sort();
  const availableSet = new Set(availableDates);

  // Horarios que sirven: si hay filtro de horario, solo los de esa franja.
  const slotsByDate = new Map<string, string[]>();
  const getSlots = async (date: string): Promise<string[]> => {
    if (!slotsByDate.has(date)) {
      const all = await fetchTimeSlots(location.locationId, date);
      const filtered = control.hours ? all.filter((t) => dateInRange(new Date(t), control.hours!)) : all;
      slotsByDate.set(date, filtered);
    }
    return slotsByDate.get(date)!;
  };

  // "Realmente disponible" = el dia tiene cupos reales (no falso positivo).
  let trulyAvailable: string[] = [];
  let earliestAvailable: string | null = null;

  if (mode === "target-dates" || mode === "window") {
    const candidates = (mode === "target-dates" ? targetDates : windowKeys).filter((d) => availableSet.has(d));
    const slots = await Promise.all(candidates.map(getSlots));
    trulyAvailable = candidates.filter((_, i) => slots[i].length > 0);
    earliestAvailable = mode === "window" ? (trulyAvailable[0] ?? null) : (availableDates[0] ?? null);
  } else {
    for (const d of availableDates.slice(0, EARLIEST_SCAN_LIMIT)) {
      if ((await getSlots(d)).length > 0) {
        earliestAvailable = d;
        break;
      }
    }
    trulyAvailable = earliestAvailable ? [earliestAvailable] : [];
  }

  return { availableDates, trulyAvailable, earliestAvailable, slotsByDate };
}

/** Tacha en los avisos ya enviados los cupos que se ocuparon. */
async function updateTakenMessages(state: State, scannedNow: Map<string, Set<string>>): Promise<void> {
  const cutoff = Date.now() - KEEP_MESSAGE_DAYS * 86_400_000;
  state.messages = state.messages.filter((m) => new Date(m.sentAt).getTime() >= cutoff).slice(-KEEP_MESSAGES);

  for (const msg of state.messages) {
    let changed = false;
    for (const n of msg.notifications) {
      const stillAvailable = scannedNow.get(n.locationId);
      if (!stillAvailable) continue; // esa ubicacion no se reviso en esta corrida
      for (const d of n.dates) {
        const key = takenKey(n.locationId, d.date);
        if (!stillAvailable.has(d.date) && !msg.taken.includes(key)) {
          msg.taken.push(key);
          changed = true;
        }
      }
    }
    if (changed) {
      await updateSentMessage(msg).catch((err) =>
        console.error("No se pudo editar el aviso:", err instanceof Error ? err.message : err),
      );
    }
  }
}

/**
 * Orquestador principal: revisa las ubicaciones activas.
 *
 * El bot de Telegram controla (via lib/control.ts) si la busqueda esta activa,
 * que ubicaciones vigilar, la ventana de dias, la franja horaria y el silencio.
 * Solo notifica fechas que ACABAN de habilitarse (deteccion por transicion).
 * Un dia se considera disponible solo si el endpoint de horarios devuelve cupos.
 */
export async function run(): Promise<RunResult> {
  const startedAt = Date.now();
  const now = new Date();

  const channels = getNotifyChannels();
  const targetDates = getTargetDates();

  if (isVercel && dedupBackend === "file") {
    throw new Error(
      "En Vercel el disco no persiste: configura UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN " +
        "para guardar el estado (si no, avisaria lo mismo en cada corrida).",
    );
  }

  const control = await loadControl();
  const windowDays = control.windowDays;
  const locations = resolveLocations(control);
  const mode: NotifyMode = targetDates.length > 0 ? "target-dates" : windowDays > 0 ? "window" : "earliest";

  const base = {
    checkedAt: now.toISOString(),
    mode,
    targetDates,
    windowDays,
    active: control.active,
    channels,
    dedupBackend,
    notifiedVia: [] as NotifyChannel[],
    deferred: 0,
    emailSent: false,
    locations: [] as LocationResult[],
  };

  // Expiracion automatica (apaga y avisa si venció).
  if (await checkExpiry(control, now)) {
    return { ...base, active: false, skipped: "paused", durationMs: Date.now() - startedAt };
  }

  if (!control.active || locations.length === 0) {
    return { ...base, skipped: "paused", durationMs: Date.now() - startedAt };
  }

  if (!(await acquireLock(LOCK_TTL_SECONDS))) {
    return { ...base, skipped: "locked", durationMs: Date.now() - startedAt };
  }

  try {
    const [state, scans] = await Promise.all([
      loadState(),
      mapLimit(locations, SCAN_CONCURRENCY, (l) => scanLocation(l, mode, targetDates, control)),
    ]);

    // Deteccion por transicion sobre las fechas con cupos reales.
    const errors: string[] = [];
    const scannedNow = new Map<string, Set<string>>();
    const events: SlotEvent[] = [];
    const results: LocationResult[] = locations.map((location, i) => {
      const r = scans[i];
      if (r.status === "rejected") {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push(`${location.name}: ${msg}`);
        return {
          name: location.name,
          locationId: location.locationId,
          totalAvailableDays: 0,
          earliestAvailable: null,
          availableTargetDates: [],
          newlyNotified: [],
          error: msg,
        };
      }
      const scan = r.value;
      scannedNow.set(location.locationId, new Set(scan.trulyAvailable));
      const diff = diffAvailable(state, location.locationId, scan.trulyAvailable);
      const newly = new Set(diff.newly);
      // Historial: a que hora aparecen los cupos y cuando se ocupan.
      const t = now.toISOString();
      for (const d of diff.newly) {
        events.push({ t, kind: "new", loc: location.name, locId: location.locationId, date: d, n: scan.slotsByDate.get(d)?.length ?? 0 });
      }
      for (const d of diff.gone) {
        events.push({ t, kind: "gone", loc: location.name, locId: location.locationId, date: d, n: 0 });
      }
      return {
        name: location.name,
        locationId: location.locationId,
        totalAvailableDays: scan.availableDates.length,
        earliestAvailable: scan.earliestAvailable,
        availableTargetDates: mode === "earliest" ? [] : scan.trulyAvailable,
        newlyNotified: scan.trulyAvailable
          .filter((d) => newly.has(d))
          .map((d) => ({ date: d, times: scan.slotsByDate.get(d) ?? [] })),
      };
    });

    if (errors.length < locations.length) state.lastCheckAt = now.toISOString();
    state.lastSummary = results
      .map((r) => {
        if (r.error) return `${r.name}: error`;
        const dates = mode === "earliest" ? (r.earliestAvailable ?? "-") : r.availableTargetDates.join(", ") || "-";
        return `${r.name}: ${dates}`;
      })
      .join("\n");

    await trackFailures(state, errors);

    if (events.length > 0) {
      await recordEvents(events).catch((err) =>
        console.error("No se pudo guardar el historial:", err instanceof Error ? err.message : err),
      );
    }

    // Novedades de esta corrida (+ las que quedaron pendientes por silencio).
    let notifications: LocationNotification[] = results
      .filter((r) => r.newlyNotified.length > 0)
      .map((r) => ({ locationName: r.name, locationId: r.locationId, dates: r.newlyNotified }));

    const quiet = inQuietHours(control, now);
    let deferred = 0;
    if (quiet) {
      state.pending.push(...notifications);
      deferred = notifications.length;
      notifications = [];
    } else if (state.pending.length > 0) {
      // Al salir del silencio: manda lo acumulado, pero solo lo que siga disponible.
      const stillValid = state.pending
        .map((p) => {
          const avail = scannedNow.get(p.locationId);
          const dates = avail ? p.dates.filter((d) => avail.has(d.date)) : [];
          return { ...p, dates };
        })
        .filter((p) => p.dates.length > 0 && !notifications.some((n) => n.locationId === p.locationId));
      notifications = [...stillValid, ...notifications];
      state.pending = [];
    }

    // Tacha cupos que se ocuparon en avisos anteriores.
    await updateTakenMessages(state, scannedNow);

    // Se guarda antes de notificar: si el aviso falla, la proxima corrida no lo repite.
    await saveState(state);

    let notifiedVia: NotifyChannel[] = [];
    if (notifications.length > 0) {
      const sent = await notify(notifications, mode);
      notifiedVia = sent.sentVia;
      if (sent.telegramMessages.length > 0) {
        state.messages.push(...sent.telegramMessages);
        await saveState(state);
      }
    }

    await maybeHeartbeat(state, control, `Estaciones: ${locations.map((l) => l.name).join(", ")}.`, now).then(
      async () => {
        if (state.lastHeartbeatDate === todayKey(now)) await saveState(state);
      },
    );

    return {
      ...base,
      locations: results,
      notifiedVia,
      deferred,
      emailSent: notifiedVia.includes("email"),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await releaseLock();
  }
}
