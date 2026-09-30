import { getJson, setJson, acquireLock as lock, releaseLock as unlock, storeBackend } from "./store.js";
import type { LocationNotification } from "./email.js";

/**
 * Estado persistente de la busqueda (una sola clave JSON "state": 1 lectura +
 * 1 escritura por corrida, para caber en el plan gratis de Upstash aunque
 * corras cada minuto). Ver lib/store.ts para los backends.
 *
 * Contiene la deteccion por transicion (que fechas estaban disponibles la
 * ultima vez), el conteo de fallos, los avisos pendientes por horas de silencio
 * y los mensajes enviados (para tacharlos si el cupo se ocupa).
 */

export const dedupBackend = storeBackend;

const STATE_KEY = "state";
const LOCK_KEY = "lock";

/** Un aviso enviado a Telegram, guardado para poder editarlo despues. */
export interface SentMessage {
  chatId: string;
  messageId: number;
  mode: "target-dates" | "window" | "earliest";
  notifications: LocationNotification[];
  /** Claves "locationId|fecha" que ya se ocuparon (se muestran tachadas). */
  taken: string[];
  sentAt: string;
}

export interface State {
  /** scope (locationId) -> fechas YYYY-MM-DD con cupos que estaban disponibles la ultima vez. */
  available: Record<string, string[]>;
  /** Cuando termino la ultima revision completa (ISO). */
  lastCheckAt?: string;
  /** Resumen corto de la ultima revision, para /estado. */
  lastSummary?: string;
  /** Fallos consecutivos consultando DEKRA. */
  failures: { count: number; lastError?: string; lastErrorAt?: string; alerted: boolean };
  /** Ultimo dia (YYYY-MM-DD) en que se mando el latido diario. */
  lastHeartbeatDate?: string;
  /** Avisos acumulados durante las horas de silencio. */
  pending: LocationNotification[];
  /** Ultimos mensajes de aviso enviados (para tachar cupos que se ocuparon). */
  messages: SentMessage[];
}

function emptyState(): State {
  return { available: {}, failures: { count: 0, alerted: false }, pending: [], messages: [] };
}

export async function loadState(): Promise<State> {
  const raw = await getJson<Record<string, unknown>>(STATE_KEY);
  if (!raw || typeof raw !== "object") return emptyState();
  // Formato viejo: { locationId: [fechas] } sin la clave "available".
  if (!("available" in raw)) return { ...emptyState(), available: raw as Record<string, string[]> };
  return { ...emptyState(), ...(raw as Partial<State>) } as State;
}

export async function saveState(state: State): Promise<void> {
  await setJson(STATE_KEY, state);
}

/**
 * Devuelve las fechas que acaban de habilitarse respecto al estado guardado
 * y actualiza el estado (en memoria) al conjunto disponible actual.
 * Llama a saveState() al terminar la corrida para persistirlo.
 */
export function takeNewlyAvailable(state: State, scope: string, availableNow: string[]): string[] {
  return diffAvailable(state, scope, availableNow).newly;
}

/**
 * Como takeNewlyAvailable, pero devuelve tambien las fechas que dejaron de
 * tener cupos ("gone"), para el historial de eventos.
 */
export function diffAvailable(
  state: State,
  scope: string,
  availableNow: string[],
): { newly: string[]; gone: string[] } {
  const prevList = state.available[scope] ?? [];
  const prev = new Set(prevList);
  const nowSet = new Set(availableNow);
  const newly = availableNow.filter((d) => !prev.has(d));
  const gone = prevList.filter((d) => !nowSet.has(d));
  state.available[scope] = availableNow;
  return { newly, gone };
}

/** Candado para evitar corridas solapadas (ej. cron cada minuto y una corrida lenta). */
export function acquireLock(ttlSeconds: number): Promise<boolean> {
  return lock(LOCK_KEY, ttlSeconds);
}

export function releaseLock(): Promise<void> {
  return unlock(LOCK_KEY);
}
