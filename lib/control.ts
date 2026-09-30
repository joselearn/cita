import { getJson, setJson } from "./store.js";
import { getLocations, getWindowDays, type DekraLocation } from "./config.js";
import type { HourRange } from "./time.js";

/**
 * "Interruptor" que controla el bot de Telegram. Vive en el almacen (Upstash o
 * archivo) y manda sobre las variables de entorno, que quedan como valores iniciales.
 */
export interface Control {
  /** Si esta en false, el cron no consulta DEKRA ni avisa. */
  active: boolean;
  /** Nombres de ubicaciones a vigilar (maximo MAX_LOCATIONS); null = ninguna elegida todavia. */
  locations: string[] | null;
  /** Ventana rodante (hoy a +N dias). 0 = usar TARGET_DATES o cita mas proxima. */
  windowDays: number;
  /** Franja horaria de las citas que sirven (hora local), ej. 6-10. null = cualquier hora. */
  hours: HourRange | null;
  /** Horas de silencio: no manda avisos en ese rango, los acumula. null = nunca. */
  quiet: HourRange | null;
  /**
   * Links rapidos: un boton por horario que lleva fecha y hora en el link, para que
   * el script "DEKRA rapido" del navegador haga los clics y rellene el formulario.
   */
  quickLinks: boolean;
  /** Cuando expira sola la busqueda (ISO). null = sin expiracion. */
  expiresAt: string | null;
  /** Ya se aviso que expira pronto. */
  expiryWarned: boolean;
  /** Ultimo cambio (ISO). */
  updatedAt: string;
}

const CONTROL_KEY = "control";

/** Maximo de ubicaciones vigiladas a la vez (para no saturar a DEKRA). */
export const MAX_LOCATIONS = Number(process.env.MAX_LOCATIONS) || 3;

/** Dias que dura una busqueda antes de apagarse sola. 0 = nunca. */
export const EXPIRE_DAYS = Number(process.env.EXPIRE_DAYS ?? 14);

/**
 * Valores por defecto cuando nadie ha hablado con el bot: EN PAUSA hasta que
 * mandes /buscar. Ventana inicial: WINDOW_DAYS del env.
 */
export function defaultControl(): Control {
  return {
    active: false,
    locations: null,
    windowDays: getWindowDays(),
    hours: null,
    quiet: null,
    quickLinks: false,
    expiresAt: null,
    expiryWarned: false,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function loadControl(): Promise<Control> {
  const saved = await getJson<Partial<Control>>(CONTROL_KEY);
  return { ...defaultControl(), ...(saved ?? {}) };
}

export async function saveControl(control: Control): Promise<void> {
  control.updatedAt = new Date().toISOString();
  await setJson(CONTROL_KEY, control);
}

/** Activa la busqueda y programa su expiracion. */
export function activate(control: Control, now = new Date()): void {
  control.active = true;
  control.expiresAt =
    EXPIRE_DAYS > 0 ? new Date(now.getTime() + EXPIRE_DAYS * 86_400_000).toISOString() : null;
  control.expiryWarned = false;
}

/** Quita acentos, guiones y mayusculas para comparar nombres de ubicacion. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Palabras que significan "todas las ubicaciones". */
export function meansAll(text: string): boolean {
  return /^(todas?|todos?|all)$/i.test(normalizeName(text));
}

export interface LocationLookup {
  found: DekraLocation[];
  /** Nombres que no coincidieron con nada. */
  unknown: string[];
  /** Nombres que coincidieron con varias (ej. "san" -> San Carlos, Santo Domingo). */
  ambiguous: { name: string; options: DekraLocation[] }[];
}

/**
 * Busca ubicaciones por nombre: primero coincidencia exacta (sin acentos ni
 * mayusculas), luego "empieza por" o "contiene" si es unica, luego por palabras
 * ("movil neily" -> Movil Ciudad Neily).
 */
export function findLocations(names: string[]): LocationLookup {
  const all = getLocations();
  const result: LocationLookup = { found: [], unknown: [], ambiguous: [] };

  for (const raw of names) {
    const q = normalizeName(raw);
    if (!q) continue;
    let matches = all.filter((l) => normalizeName(l.name) === q);
    if (matches.length === 0) matches = all.filter((l) => normalizeName(l.name).startsWith(q));
    if (matches.length === 0) matches = all.filter((l) => normalizeName(l.name).includes(q));
    if (matches.length === 0) {
      const words = q.split(" ");
      matches = all.filter((l) => {
        const nameWords = normalizeName(l.name).split(" ");
        return words.every((w) => nameWords.some((nw) => nw.startsWith(w)));
      });
    }

    if (matches.length === 1) {
      if (!result.found.includes(matches[0])) result.found.push(matches[0]);
    } else if (matches.length === 0) {
      result.unknown.push(raw.trim());
    } else {
      result.ambiguous.push({ name: raw.trim(), options: matches });
    }
  }
  return result;
}

/** Ubicaciones efectivas segun el control (vacio si no se ha elegido ninguna). */
export function resolveLocations(control: Control): DekraLocation[] {
  if (!control.locations || control.locations.length === 0) return [];
  const all = getLocations();
  const wanted = new Set(control.locations.map(normalizeName));
  return all.filter((l) => wanted.has(normalizeName(l.name))).slice(0, MAX_LOCATIONS);
}

/** True si el nombre esta en la seleccion actual. */
export function isSelected(control: Control, name: string): boolean {
  return (control.locations ?? []).some((n) => normalizeName(n) === normalizeName(name));
}

/**
 * Agrega o quita una ubicacion de la seleccion. Devuelve false si no cabe
 * (ya hay MAX_LOCATIONS).
 */
export function toggleLocation(control: Control, name: string): boolean {
  const current = control.locations ?? [];
  if (isSelected(control, name)) {
    control.locations = current.filter((n) => normalizeName(n) !== normalizeName(name));
    return true;
  }
  if (current.length >= MAX_LOCATIONS) return false;
  control.locations = [...current, name];
  return true;
}
