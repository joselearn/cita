import type { VercelRequest, VercelResponse } from "@vercel/node";
import { run } from "../lib/run.js";
import { cronSecret } from "../lib/config.js";

/**
 * Endpoint que dispara la verificacion (desplegado en Vercel).
 *
 * Lo invoca cron-job.org cada minuto con el header:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Si CRON_SECRET no esta definido, el endpoint queda abierto (solo para probar).
 * En Vercel es obligatorio configurar Upstash (ver lib/dedup.ts).
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
    if (result.skipped === "paused") {
      console.log("Busqueda en pausa (manda /buscar al bot para activarla).");
    } else if (result.skipped === "locked") {
      console.log("Corrida saltada: otra estaba en curso.");
    } else {
      const resumen = result.locations
        .map((l) =>
          l.error
            ? `${l.name}: ERROR ${l.error}`
            : `${l.name}: ${l.newlyNotified.length ? "NUEVO " + l.newlyNotified.map((n) => n.date).join(",") : "sin novedades"}`,
        )
        .join(" | ");
      console.log(
        `[${result.mode}] ${resumen}${result.notifiedVia.length ? ` -> aviso por ${result.notifiedVia.join(",")}` : ""} (${result.durationMs} ms)`,
      );
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error en /api/check:", message);
    return res.status(500).json({ ok: false, error: message });
  }
}
