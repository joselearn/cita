import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { redisConfig } from "./config.js";

/**
 * Deteccion por transicion (edge-triggered).
 *
 * Recuerda el conjunto de fechas que estaban disponibles en la corrida anterior
 * (por `scope`, ej. una ubicacion) y devuelve solo las que ACABAN de habilitarse.
 *
 * Dos backends de almacenamiento:
 *   - "upstash": si configuras UPSTASH_REDIS_REST_URL/TOKEN (sirve en Vercel).
 *   - "file":    si no, guarda el estado en un archivo local (.state/available.json).
 *                Funciona en local y en GitHub Actions (cacheando ese archivo).
 *                No sirve en Vercel porque su disco no persiste entre llamadas.
 */

let redis: Redis | null = null;
if (redisConfig.url && redisConfig.token) {
  redis = new Redis({ url: redisConfig.url, token: redisConfig.token });
}

export const dedupBackend: "upstash" | "file" = redis ? "upstash" : "file";

const STATE_FILE = path.resolve(process.env.STATE_DIR?.trim() || ".state", "available.json");

type FileState = Record<string, string[]>;

async function readFileState(): Promise<FileState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as FileState;
  } catch {
    return {};
  }
}

async function writeFileState(state: FileState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state));
}

function diffNewly(prev: string[], availableNow: string[]): string[] {
  const prevSet = new Set(prev);
  return availableNow.filter((d) => !prevSet.has(d));
}

/**
 * Devuelve las fechas que acaban de habilitarse respecto a la corrida anterior
 * y actualiza el estado guardado al conjunto disponible actual.
 */
export async function selectNewlyAvailable(
  scope: string,
  availableNow: string[],
): Promise<string[]> {
  if (redis) {
    const key = `cita:available:${scope}`;
    const prev = (await redis.smembers(key)) as string[];
    const newly = diffNewly(prev, availableNow);

    await redis.del(key);
    if (availableNow.length > 0) {
      const [first, ...rest] = availableNow;
      await redis.sadd(key, first, ...rest);
    }
    return newly;
  }

  // Fallback a archivo local.
  const state = await readFileState();
  const newly = diffNewly(state[scope] ?? [], availableNow);
  state[scope] = availableNow;
  await writeFileState(state);
  return newly;
}
