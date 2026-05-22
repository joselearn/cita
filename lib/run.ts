import { fetchAvailableDays, fetchTimeSlots, toDateKey } from "./dekra.js";
import { getTargetDates, getLocations, type DekraLocation } from "./config.js";
import { selectNewlyAvailable, dedupBackend } from "./dedup.js";
import { sendAvailabilityEmail, type LocationNotification, type DateSlots } from "./email.js";

export interface LocationResult {
  name: string;
  locationId: string;
  totalAvailableDays: number;
  earliestAvailable: string | null;
  /** Fechas objetivo con cupos reales (no solo "disponibles" a nivel dia). */
  availableTargetDates: string[];
  /** Fechas que acaban de habilitarse, con sus horarios. */
  newlyNotified: DateSlots[];
}

export interface RunResult {
  checkedAt: string;
  mode: "target-dates" | "earliest";
  targetDates: string[];
  locations: LocationResult[];
  emailSent: boolean;
  dedupBackend: "upstash" | "file";
}

/**
 * Maximo de dias a consultar (horarios) en modo "cita mas proxima" buscando el
 * primer dia con cupos reales. Evita demasiadas llamadas si hay muchos dias
 * "disponibles" pero sin horarios. Configurable con EARLIEST_SCAN_LIMIT.
 */
const EARLIEST_SCAN_LIMIT = Number(process.env.EARLIEST_SCAN_LIMIT) || 12;

/** Procesa una sola ubicacion: consulta, valida horarios y detecta novedades. */
async function checkLocation(
  location: DekraLocation,
  targetDates: string[],
  mode: "target-dates" | "earliest",
): Promise<LocationResult> {
  const days = await fetchAvailableDays(location.locationId);

  const availableDates = Array.from(
    new Set(days.filter((d) => d.isAvailable).map((d) => toDateKey(d.date))),
  ).sort();

  // Cache de horarios por fecha (para no consultar dos veces la misma).
  const slotsByDate = new Map<string, string[]>();
  const getSlots = async (date: string): Promise<string[]> => {
    if (!slotsByDate.has(date)) {
      try {
        slotsByDate.set(date, await fetchTimeSlots(location.locationId, date));
      } catch {
        slotsByDate.set(date, []);
      }
    }
    return slotsByDate.get(date)!;
  };

  // "Realmente disponible" = el dia tiene cupos reales (no falso positivo).
  let trulyAvailable: string[];
  let earliestAvailable: string | null = null;

  if (mode === "target-dates") {
    const availableSet = new Set(availableDates);
    const dayLevel = targetDates.filter((d) => availableSet.has(d));
    trulyAvailable = [];
    for (const d of dayLevel) {
      if ((await getSlots(d)).length > 0) trulyAvailable.push(d);
    }
    earliestAvailable = availableDates[0] ?? null;
  } else {
    // Busca el primer dia (en orden) que tenga cupos reales.
    for (const d of availableDates.slice(0, EARLIEST_SCAN_LIMIT)) {
      if ((await getSlots(d)).length > 0) {
        earliestAvailable = d;
        break;
      }
    }
    trulyAvailable = earliestAvailable ? [earliestAvailable] : [];
  }

  // Deteccion por transicion sobre las fechas con cupos reales.
  const newly = new Set(await selectNewlyAvailable(location.locationId, trulyAvailable));
  const newlyNotified: DateSlots[] = trulyAvailable
    .filter((d) => newly.has(d))
    .map((d) => ({ date: d, times: slotsByDate.get(d) ?? [] }));

  return {
    name: location.name,
    locationId: location.locationId,
    totalAvailableDays: availableDates.length,
    earliestAvailable,
    availableTargetDates: mode === "target-dates" ? trulyAvailable : [],
    newlyNotified,
  };
}

/**
 * Orquestador principal: revisa todas las ubicaciones configuradas.
 *
 * - Con TARGET_DATES: avisa cuando alguna de esas fechas tiene cupos reales.
 * - Sin TARGET_DATES: avisa de la cita mas proxima con cupos reales por ubicacion.
 *
 * Solo notifica fechas que ACABAN de habilitarse (deteccion por transicion).
 * Un dia se considera disponible solo si el endpoint de horarios devuelve cupos
 * (el endpoint de dias da falsos positivos). Si hay novedades, un unico correo.
 */
export async function run(): Promise<RunResult> {
  const targetDates = getTargetDates();
  const locations = getLocations();
  const mode = targetDates.length > 0 ? "target-dates" : "earliest";

  const results: LocationResult[] = [];
  for (const location of locations) {
    results.push(await checkLocation(location, targetDates, mode));
  }

  const notifications: LocationNotification[] = results
    .filter((r) => r.newlyNotified.length > 0)
    .map((r) => ({
      locationName: r.name,
      locationId: r.locationId,
      dates: r.newlyNotified,
    }));

  let emailSent = false;
  if (notifications.length > 0) {
    await sendAvailabilityEmail(notifications, mode);
    emailSent = true;
  }

  return {
    checkedAt: new Date().toISOString(),
    mode,
    targetDates,
    locations: results,
    emailSent,
    dedupBackend,
  };
}
