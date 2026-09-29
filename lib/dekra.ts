import { dekraConfig, getBookingUrl } from "./config.js";
import { todayKey, addDays } from "./time.js";

export { todayKey, addDays };

export interface AvailableDay {
  date: string; // ej: "2026-06-03T06:00:00.0000000Z"
  isAvailable: boolean;
}

/** Reintentos ante 429/5xx o error de red, con espera creciente. */
const RETRIES = Number(process.env.DEKRA_RETRIES ?? 2);
const RETRY_DELAYS_MS = [1000, 3000, 6000];

export class DekraError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DekraError";
  }
}

/**
 * fetch con reintentos: si DEKRA responde 429 o 5xx, o falla la red, espera y
 * vuelve a intentar. Los 4xx (salvo 429) no se reintentan: son errores nuestros.
 */
async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]));
    }
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      lastError = new DekraError(`DEKRA ${label} respondio ${res.status}. ${body.slice(0, 200)}`, res.status);
      if (res.status !== 429 && res.status < 500) throw lastError;
    } catch (err) {
      if (err instanceof DekraError && err.status && err.status !== 429 && err.status < 500) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Claves de hoy a hoy+days (ambos inclusive), en hora de Costa Rica. */
export function windowDateKeys(days: number): string[] {
  const today = todayKey();
  return Array.from({ length: days + 1 }, (_, i) => addDays(today, i));
}

/**
 * Calcula la ventana de consulta. Por defecto consulta desde hoy hasta
 * 1 mes en el futuro. Se puede sobreescribir con START_DATE / END_DATE
 * (formato YYYY-MM-DD) o, por codigo, con `endDateKey`.
 */
function buildDateRange(endDateKey?: string): { startDate: string; endDate: string } {
  const startKey = process.env.START_DATE?.trim() || todayKey();
  const endKey = endDateKey || process.env.END_DATE?.trim() || addDays(startKey, 31);

  // DEKRA maneja los dias de 06:00Z a 05:59Z (medianoche a medianoche en Costa Rica).
  return {
    startDate: `${startKey}T06:00:00.000Z`,
    endDate: `${addDays(endKey, 1)}T05:59:59.999Z`,
  };
}

export interface FetchDaysOptions {
  /** Ultimo dia (YYYY-MM-DD) a consultar. Si se omite, usa END_DATE o +1 mes. */
  endDateKey?: string;
}

/** Consulta el endpoint de DEKRA para una ubicacion y devuelve los dias disponibles. */
export async function fetchAvailableDays(
  locationId: string,
  options: FetchDaysOptions = {},
): Promise<AvailableDay[]> {
  const { startDate, endDate } = buildDateRange(options.endDateKey);

  const params = new URLSearchParams({
    startDate,
    endDate,
    tenantId: dekraConfig.tenantId,
    productId: dekraConfig.productId,
    locationId,
    editBookingId: "undefined",
    selectedProductIdList: dekraConfig.productId,
  });

  const url = `${dekraConfig.baseUrl}?${params.toString()}`;

  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9,es;q=0.8",
    "content-type": "application/json",
    referer: getBookingUrl(locationId),
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  if (dekraConfig.cookie) {
    headers.cookie = dekraConfig.cookie;
  }

  const res = await fetchWithRetry(url, { method: "GET", headers }, "dias");

  const data = (await res.json()) as AvailableDay[];
  if (!Array.isArray(data)) {
    throw new DekraError("Respuesta inesperada de DEKRA (dias): no es un arreglo.");
  }
  return data;
}

/** Devuelve la parte YYYY-MM-DD de una fecha ISO de DEKRA. */
export function toDateKey(isoDate: string): string {
  return isoDate.slice(0, 10);
}

const TIME_SLOTS_URL =
  process.env.DEKRA_TIMESLOTS_URL?.trim() ||
  "https://booking.dekra.com/api/v1/booking/retail/filter-time-slots";

interface TimeSlotResponse {
  time: string;
}

/**
 * Consulta los horarios disponibles de un dia concreto en una ubicacion.
 * Devuelve las horas en formato ISO (UTC).
 */
export async function fetchTimeSlots(locationId: string, dateKey: string): Promise<string[]> {
  const body = {
    isRetail: true,
    tenantId: dekraConfig.tenantId,
    locationId,
    productIds: [dekraConfig.productId],
    startDate: `${dateKey}T06:00:00.000Z`,
    endDate: `${addDays(dateKey, 1)}T05:59:59.999Z`,
    selectedTimeslots: [],
  };

  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://booking.dekra.com",
    referer: getBookingUrl(locationId),
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  if (dekraConfig.cookie) {
    headers.cookie = dekraConfig.cookie;
  }

  const res = await fetchWithRetry(
    TIME_SLOTS_URL,
    { method: "POST", headers, body: JSON.stringify(body) },
    "horarios",
  );

  const data = (await res.json()) as TimeSlotResponse[];
  if (!Array.isArray(data)) {
    throw new DekraError("Respuesta inesperada de DEKRA (horarios): no es un arreglo.");
  }
  return data.map((s) => s.time);
}
