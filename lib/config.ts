/**
 * Configuracion leida desde variables de entorno.
 *
 * En Vercel se configuran en Project Settings -> Environment Variables.
 * En local se leen desde el archivo .env (ver .env.example).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/** Identificadores del endpoint de DEKRA (sacados del CURL original). */
export const dekraConfig = {
  baseUrl: optional(
    "DEKRA_BASE_URL",
    "https://booking.dekra.com/api/v1/booking/retail/availabledays",
  ),
  tenantId: optional("DEKRA_TENANT_ID", "81795580-f3e6-4ee0-8274-38f3b42598f9"),
  productId: optional("DEKRA_PRODUCT_ID", "d382c5cc-f92c-449c-8f5d-ea82afe286a9"),
  /** Cookies opcionales por si el endpoint llegara a exigirlas. */
  cookie: process.env.DEKRA_COOKIE?.trim() || undefined,
};

export interface DekraLocation {
  name: string;
  locationId: string;
}

/**
 * Todas las estaciones de DEKRA Costa Rica que permiten reservar en linea
 * (sacadas de su API el 2026-09-29). Los nombres son los que entiende el bot.
 */
const DEFAULT_LOCATIONS: DekraLocation[] = [
  { name: "Alajuela", locationId: "4e130e21-02b8-4158-a7fa-7c446cb9bd2c" },
  { name: "Alajuelita", locationId: "24607c9c-daa0-45b5-bece-f82e2ce014c2" },
  { name: "Cañas", locationId: "4557234a-a2ae-4b47-a519-5f53ebacf74e" },
  { name: "Cartago", locationId: "4f86bfca-104d-4b8f-9a5c-48751bb43583" },
  { name: "Guápiles", locationId: "806567ba-9a68-4b29-9df6-96b234e59e7e" },
  { name: "Heredia", locationId: "7bb8d264-2270-4c3e-a4ea-529d222f5df8" },
  { name: "Liberia", locationId: "3475f8c2-ce52-4dcd-bf5d-24b3502215c2" },
  { name: "Limón", locationId: "2b585a6d-acaf-49ae-b8f0-fe45c2943b6e" },
  { name: "Nicoya", locationId: "e8d5f1ac-8a61-465c-b13b-32d34fc56484" },
  { name: "Pérez Zeledón", locationId: "9ae905be-0213-4726-a42e-34928ecdfc28" },
  { name: "Puntarenas", locationId: "94801ed6-96ff-4247-956d-77451609a767" },
  { name: "San Carlos", locationId: "b17c0dd3-b966-4723-a26f-cc7ee3ff5b45" },
  { name: "Santo Domingo", locationId: "b4b9ed78-8782-47ed-b9ef-5abb42bf4703" },
  { name: "Móvil Guatuso", locationId: "fcca196f-535f-4b70-b60c-212c09f810f2" },
  { name: "Móvil San Marcos", locationId: "875a4fd6-a315-4f44-a294-48bddfb1972d" },
  { name: "Móvil Ciudad Neily", locationId: "36c16ed0-db97-4fef-98b4-df4d7139af27" },
];

/**
 * Ubicaciones que el bot puede vigilar. Por defecto todas las de DEKRA Costa Rica.
 * Se puede acotar con la variable LOCATIONS en formato:
 *   LOCATIONS="Alajuela:4e130e21-...,Puntarenas:94801ed6-..."
 */
export function getLocations(): DekraLocation[] {
  const raw = process.env.LOCATIONS?.trim();
  if (!raw) return DEFAULT_LOCATIONS;

  return raw.split(",").map((pair) => {
    const idx = pair.indexOf(":");
    if (idx === -1) {
      throw new Error(`Entrada invalida en LOCATIONS: "${pair}". Usa formato Nombre:locationId.`);
    }
    const name = pair.slice(0, idx).trim();
    const locationId = pair.slice(idx + 1).trim();
    if (!name || !locationId) {
      throw new Error(`Entrada invalida en LOCATIONS: "${pair}". Usa formato Nombre:locationId.`);
    }
    return { name, locationId };
  });
}

/**
 * Link para crear la cita en una ubicacion concreta. Se puede sobreescribir
 * el patron con la variable BOOKING_URL_TEMPLATE usando {locationId}.
 */
export function getBookingUrl(locationId: string): string {
  const template = optional(
    "BOOKING_URL_TEMPLATE",
    "https://booking.dekra.com/book/customer-retail/CR/location/{locationId}/",
  );
  return template.replace("{locationId}", locationId);
}

/**
 * Link rapido: el mismo link de la estacion mas la fecha y hora locales en el
 * fragmento (#cita=YYYY-MM-DDTHH:MM). DEKRA lo ignora; el script del navegador lo lee.
 */
export function getQuickBookingUrl(locationId: string, dateKey: string, timeHHMM: string): string {
  return `${getBookingUrl(locationId)}#cita=${dateKey}T${timeHHMM}`;
}

/** URL publica del script "DEKRA rapido" (se sirve desde /public en Vercel). */
export function getUserscriptUrl(): string {
  const base = process.env.PUBLIC_BASE_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return `${base.replace(/\/+$/, "")}/dekra-rapido.user.js`;
}

function assertDate(d: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`Fecha invalida en TARGET_DATES: "${d}". Usa formato YYYY-MM-DD.`);
  }
}

/** Expande un rango inclusivo "2026-05-22".."2026-05-30" a todos sus dias. */
function expandRange(start: string, end: string): string[] {
  assertDate(start);
  assertDate(end);
  const last = new Date(`${end}T00:00:00.000Z`);
  const cur = new Date(`${start}T00:00:00.000Z`);
  if (cur > last) {
    throw new Error(`Rango invalido en TARGET_DATES: "${start}..${end}" (inicio despues del fin).`);
  }
  const dates: string[] = [];
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Fechas que te interesan, separadas por coma. Cada elemento puede ser:
 *   - una fecha:  2026-06-15
 *   - un rango:   2026-05-22..2026-05-30  (ambos extremos incluidos)
 * Ej: TARGET_DATES="2026-05-22..2026-05-30,2026-06-15"
 *
 * Es OPCIONAL: si no se define, el sistema avisa de la cita mas proxima.
 */
export function getTargetDates(): string[] {
  const raw = process.env.TARGET_DATES?.trim();
  if (!raw) return [];

  const dates = new Set<string>();
  for (const token of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (token.includes("..")) {
      const [start, end] = token.split("..").map((s) => s.trim());
      for (const d of expandRange(start, end)) dates.add(d);
    } else {
      assertDate(token);
      dates.add(token);
    }
  }
  return [...dates].sort();
}

/**
 * Ventana corta rodante: vigila de hoy a +N dias y avisa de CUALQUIER fecha
 * nueva dentro de esa ventana (ideal para cazar cancelaciones de ultimo momento).
 * 0 o vacio = desactivado. Si tambien defines TARGET_DATES, TARGET_DATES manda.
 */
export function getWindowDays(): number {
  const raw = process.env.WINDOW_DAYS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 60) {
    throw new Error(`WINDOW_DAYS invalido: "${raw}". Usa un entero entre 0 y 60.`);
  }
  return n;
}

/**
 * Modo de aviso:
 *   - "target-dates": fechas concretas (TARGET_DATES).
 *   - "window":       cualquier fecha nueva en los proximos WINDOW_DAYS dias.
 *   - "earliest":     la cita mas proxima por ubicacion.
 */
export type NotifyMode = "target-dates" | "window" | "earliest";

/** Texto introductorio del aviso segun el modo. */
export function introForMode(mode: NotifyMode): string {
  switch (mode) {
    case "target-dates":
      return "Se habilito disponibilidad en las fechas que te interesan:";
    case "window":
      return "Se liberaron citas para los proximos dias:";
    case "earliest":
      return "Estas son las citas mas proximas que acaban de habilitarse:";
  }
}

/** True cuando el codigo corre dentro de una funcion de Vercel. */
export const isVercel = Boolean(process.env.VERCEL);

export function getEmailConfig() {
  return {
    apiKey: required("RESEND_API_KEY"),
    from: optional("EMAIL_FROM", "DEKRA Watcher <onboarding@resend.dev>"),
    to: required("EMAIL_TO"),
  };
}

/**
 * Configuracion de Telegram (Bot API, gratis).
 * TELEGRAM_CHAT_ID acepta varios ids separados por coma (para avisar a varias personas).
 * Obten el tuyo con: npm run telegram:chatid
 */
export function getTelegramConfig() {
  const chatIds = required("TELEGRAM_CHAT_ID")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of chatIds) {
    if (!/^-?\d+$/.test(id)) {
      throw new Error(
        `Chat id invalido en TELEGRAM_CHAT_ID: "${id}". Debe ser numerico; obtenlo con "npm run telegram:chatid".`,
      );
    }
  }
  const botToken = required("TELEGRAM_BOT_TOKEN");
  if (!/^\d+:[\w-]{30,}$/.test(botToken)) {
    throw new Error('TELEGRAM_BOT_TOKEN no parece valido. Debe verse como "123456789:AAH...".');
  }
  return {
    botToken,
    chatIds,
    /** Secreto que Telegram manda en cada llamada al webhook (api/telegram.ts). */
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
  };
}

export type NotifyChannel = "email" | "telegram";

/**
 * Canales por los que se envia el aviso.
 *
 * - Con NOTIFY_CHANNELS definido (ej. "telegram", "email" o "email,telegram") se usan esos.
 * - Sin definir, se detecta automaticamente: "telegram" si hay TELEGRAM_BOT_TOKEN,
 *   "email" si hay RESEND_API_KEY (pueden ser ambos).
 */
export function getNotifyChannels(): NotifyChannel[] {
  const raw = process.env.NOTIFY_CHANNELS?.trim();
  let channels: NotifyChannel[];

  if (raw) {
    channels = raw
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
      .map((c) => {
        if (c !== "email" && c !== "telegram") {
          throw new Error(`Canal invalido en NOTIFY_CHANNELS: "${c}". Usa email, telegram o ambos.`);
        }
        return c;
      });
  } else {
    channels = [];
    if (process.env.RESEND_API_KEY?.trim()) channels.push("email");
    if (process.env.TELEGRAM_BOT_TOKEN?.trim()) channels.push("telegram");
  }

  channels = [...new Set(channels)];
  if (channels.length === 0) {
    throw new Error(
      "No hay ningun canal de notificacion configurado. Define TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID " +
        "(Telegram) o RESEND_API_KEY/EMAIL_TO (correo).",
    );
  }
  return channels;
}

/** Upstash Redis es opcional: si no esta configurado, no se hace dedup. */
export const redisConfig = {
  url: process.env.UPSTASH_REDIS_REST_URL?.trim(),
  token: process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
};

export const cronSecret = process.env.CRON_SECRET?.trim();
