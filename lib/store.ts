import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { redisConfig } from "./config.js";

/**
 * Almacen clave -> JSON con dos backends (el codigo elige automaticamente):
 *   - "upstash": si configuras UPSTASH_REDIS_REST_URL/TOKEN (obligatorio en Vercel).
 *   - "file":    si no, un archivo por clave en .state/ (local y GitHub Actions).
 */

let redis: Redis | null = null;
if (redisConfig.url && redisConfig.token) {
  redis = new Redis({ url: redisConfig.url, token: redisConfig.token });
}

export const storeBackend: "upstash" | "file" = redis ? "upstash" : "file";

const STATE_DIR = path.resolve(process.env.STATE_DIR?.trim() || ".state");

/** Prefijo de las claves en Redis (por si compartes la base con otra cosa). */
const KEY_PREFIX = process.env.STATE_KEY?.trim() || "cita";

function fileFor(key: string): string {
  return path.join(STATE_DIR, `${key}.json`);
}

function redisKey(key: string): string {
  return `${KEY_PREFIX}:${key}`;
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (redis) {
    const value = await redis.get<T>(redisKey(key));
    return value ?? null;
  }
  try {
    return JSON.parse(await fs.readFile(fileFor(key), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function setJson<T>(key: string, value: T): Promise<void> {
  if (redis) {
    await redis.set(redisKey(key), value);
    return;
  }
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(fileFor(key), JSON.stringify(value));
}

/**
 * Candado con expiracion. Devuelve true si se obtuvo.
 * Solo aplica con Upstash; en local o GitHub Actions no hace falta.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  if (!redis) return true;
  const result = await redis.set(redisKey(key), Date.now(), { nx: true, ex: ttlSeconds });
  return result === "OK";
}

export async function releaseLock(key: string): Promise<void> {
  if (!redis) return;
  await redis.del(redisKey(key));
}
