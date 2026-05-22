import { fetchAvailableDays, toDateKey } from "./dekra.js";
import { getTargetDates, getLocations, type DekraLocation } from "./config.js";
import { selectNewlyAvailable, dedupBackend } from "./dedup.js";
import { sendAvailabilityEmail, type LocationNotification } from "./email.js";

export interface LocationResult {
  name: string;
  locationId: string;
  totalAvailableDays: number;
  earliestAvailable: string | null;
  availableTargetDates: string[];
  newlyNotified: string[];
}

export interface RunResult {
  checkedAt: string;
  mode: "target-dates" | "earliest";
  targetDates: string[];
  locations: LocationResult[];
  emailSent: boolean;
  dedupBackend: "upstash" | "file";
}

/** Procesa una sola ubicacion: consulta, detecta novedades y devuelve el resultado. */
async function checkLocation(
  location: DekraLocation,
  targetDates: string[],
  mode: "target-dates" | "earliest",
): Promise<LocationResult> {
  const days = await fetchAvailableDays(location.locationId);

  const availableDates = Array.from(
    new Set(days.filter((d) => d.isAvailable).map((d) => toDateKey(d.date))),
  ).sort();

  const earliestAvailable = availableDates[0] ?? null;

  // Fechas que acaban de habilitarse respecto a la corrida anterior (por ubicacion).
  const newlyAvailable = new Set(
    await selectNewlyAvailable(location.locationId, availableDates),
  );

  let candidates: string[];
  let availableTargetDates: string[] = [];

  if (mode === "target-dates") {
    const availableSet = new Set(availableDates);
    availableTargetDates = targetDates.filter((d) => availableSet.has(d));
    candidates = availableTargetDates.filter((d) => newlyAvailable.has(d));
  } else {
    candidates =
      earliestAvailable && newlyAvailable.has(earliestAvailable) ? [earliestAvailable] : [];
  }

  return {
    name: location.name,
    locationId: location.locationId,
    totalAvailableDays: availableDates.length,
    earliestAvailable,
    availableTargetDates,
    newlyNotified: candidates,
  };
}

/**
 * Orquestador principal: revisa todas las ubicaciones configuradas.
 *
 * - Con TARGET_DATES: avisa cuando alguna de esas fechas se habilita en alguna ubicacion.
 * - Sin TARGET_DATES: avisa de la cita mas proxima por ubicacion.
 *
 * Solo notifica fechas que ACABAN de habilitarse (deteccion por transicion, via Upstash).
 * Si hay novedades en una o varias ubicaciones, se envia un unico correo.
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
