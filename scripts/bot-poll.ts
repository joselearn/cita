/**
 * Corre el bot en tu maquina SIN Vercel ni webhook: pregunta a Telegram por
 * mensajes nuevos (long polling) y responde a comandos y botones. Opcionalmente
 * corre tambien la revision de citas cada N segundos, para probar todo el flujo
 * desde el celular.
 *
 *   npm run bot:poll              solo comandos
 *   npm run bot:poll -- 60        comandos + revision cada 60 s (si /buscar esta activo)
 *
 * Detenlo con Ctrl+C. No lo uses a la vez que el webhook (Telegram solo permite uno).
 */
import "dotenv/config";
import { getTelegramConfig } from "../lib/config.js";
import { processUpdate, type TelegramUpdate } from "../lib/bot.js";
import { run } from "../lib/run.js";

const cfg = getTelegramConfig();
const checkEverySeconds = Number(process.argv[2]) || 0;
const api = `https://api.telegram.org/bot${cfg.botToken}`;

function stamp(): string {
  return new Date().toLocaleTimeString("es-CR", { timeZone: "America/Costa_Rica", hour12: false });
}
const log = (line: string) => console.log(`[${stamp()}] ${line}`);

// Si hay un webhook registrado, getUpdates falla con 409. Avisa claro.
const info = (await (await fetch(`${api}/getWebhookInfo`)).json()) as { result?: { url?: string } };
if (info.result?.url) {
  console.error(`Hay un webhook registrado (${info.result.url}). Borralo primero con: npm run telegram:webhook -- --delete`);
  process.exit(1);
}

log(`Bot escuchando (chats autorizados: ${cfg.chatIds.join(", ")}).`);
if (checkEverySeconds > 0) log(`Revision de citas cada ${checkEverySeconds} s.`);
console.log("Escribele al bot desde el celular. Ctrl+C para salir.\n");

// --- Revision periodica (opcional) ---
if (checkEverySeconds > 0) {
  const tick = async () => {
    try {
      const r = await run();
      if (r.skipped === "paused") log("check: en pausa");
      else if (r.skipped === "locked") log("check: otra corrida en curso");
      else {
        const resumen = r.locations
          .map((l) => `${l.name} ${l.error ? "ERROR" : l.newlyNotified.length ? "NUEVO " + l.newlyNotified.map((n) => n.date).join(",") : "-"}`)
          .join(" | ");
        log(`check [${r.mode}]: ${resumen}${r.notifiedVia.length ? " -> AVISO" : ""}${r.deferred ? ` (${r.deferred} en silencio)` : ""} (${r.durationMs} ms)`);
      }
    } catch (err) {
      log(`check fallo: ${err instanceof Error ? err.message : err}`);
    }
  };
  void tick();
  setInterval(tick, checkEverySeconds * 1000);
}

// --- Long polling de comandos y botones ---
let offset = 0;
for (;;) {
  try {
    const res = await fetch(`${api}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message", "callback_query"] }),
    });
    const data = (await res.json()) as { ok: boolean; result?: (TelegramUpdate & { update_id: number })[]; description?: string };
    if (!data.ok) throw new Error(data.description ?? `HTTP ${res.status}`);

    for (const u of data.result ?? []) {
      offset = u.update_id + 1;
      await processUpdate(u, log);
    }
  } catch (err) {
    log(`polling fallo: ${err instanceof Error ? err.message : err}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
