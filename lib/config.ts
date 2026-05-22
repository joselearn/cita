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

const DEFAULT_LOCATIONS: DekraLocation[] = [
  { name: "Alajuela", locationId: "4e130e21-02b8-4158-a7fa-7c446cb9bd2c" },
  { name: "Puntarenas", locationId: "94801ed6-96ff-4247-956d-77451609a767" },
];

/**
 * Ubicaciones a revisar. Por defecto Alajuela y Puntarenas.
 * Se puede sobreescribir con la variable LOCATIONS en formato:
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
 * Fechas que te interesan, en formato YYYY-MM-DD separadas por coma.
 * Ej: TARGET_DATES="2026-06-15,2026-06-16,2026-06-17"
 *
 * Es OPCIONAL: si no se define, el sistema avisa de la cita mas proxima
 * disponible dentro de la ventana de busqueda.
 */
export function getTargetDates(): string[] {
  const raw = process.env.TARGET_DATES?.trim();
  if (!raw) return [];

  const dates = raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new Error(`Fecha invalida en TARGET_DATES: "${d}". Usa formato YYYY-MM-DD.`);
    }
  }
  return dates;
}

export function getEmailConfig() {
  return {
    apiKey: required("RESEND_API_KEY"),
    from: optional("EMAIL_FROM", "DEKRA Watcher <onboarding@resend.dev>"),
    to: required("EMAIL_TO"),
  };
}

/** Upstash Redis es opcional: si no esta configurado, no se hace dedup. */
export const redisConfig = {
  url: process.env.UPSTASH_REDIS_REST_URL?.trim(),
  token: process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
};

export const cronSecret = process.env.CRON_SECRET?.trim();
