import type { VercelRequest, VercelResponse } from "@vercel/node";
import { run } from "../lib/run.js";
import { cronSecret } from "../lib/config.js";

/**
 * Endpoint que dispara la verificacion.
 *
 * Lo invoca:
 *  - El cron de GitHub Actions (cada hora) con el header Authorization.
 *  - El cron de Vercel (1 vez/dia) que agrega el Authorization automaticamente
 *    cuando existe la variable CRON_SECRET.
 *
 * Si CRON_SECRET no esta definido, el endpoint queda abierto (util para probar).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }
  }

  try {
    const result = await run();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error en /api/check:", message);
    return res.status(500).json({ ok: false, error: message });
  }
}
