import { dekraConfig, getBookingUrl } from "./config.js";

export interface AvailableDay {
  date: string; // ej: "2026-06-03T06:00:00.0000000Z"
  isAvailable: boolean;
}

/**
 * Calcula la ventana de consulta. Por defecto consulta desde hoy hasta
 * 1 mes en el futuro. Se puede sobreescribir con START_DATE / END_DATE
 * (formato YYYY-MM-DD).
 */
function buildDateRange(): { startDate: string; endDate: string } {
  const startEnv = process.env.START_DATE?.trim();
  const endEnv = process.env.END_DATE?.trim();

  const start = startEnv ? new Date(`${startEnv}T00:00:00.000Z`) : new Date();

  let end: Date;
  if (endEnv) {
    end = new Date(`${endEnv}T23:59:59.999Z`);
  } else {
    // Un mes a partir de hoy.
    end = new Date();
    end.setUTCMonth(end.getUTCMonth() + 1);
  }

  // El endpoint espera el inicio del dia y el final del dia en UTC.
  const startDate = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 6, 0, 0, 0),
  ).toISOString();
  const endDate = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 5, 59, 59, 999),
  ).toISOString();

  return { startDate, endDate };
}

/** Consulta el endpoint de DEKRA para una ubicacion y devuelve los dias disponibles. */
export async function fetchAvailableDays(locationId: string): Promise<AvailableDay[]> {
  const { startDate, endDate } = buildDateRange();

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

  const res = await fetch(url, { method: "GET", headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DEKRA respondio ${res.status} ${res.statusText}. ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as AvailableDay[];
  if (!Array.isArray(data)) {
    throw new Error("Respuesta inesperada de DEKRA: no es un arreglo.");
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

/** Suma un dia a una clave YYYY-MM-DD. */
function nextDayKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
    endDate: `${nextDayKey(dateKey)}T05:59:59.999Z`,
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

  const res = await fetch(TIME_SLOTS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DEKRA time-slots respondio ${res.status}. ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as TimeSlotResponse[];
  if (!Array.isArray(data)) return [];
  return data.map((s) => s.time);
}
