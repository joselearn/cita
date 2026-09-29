import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getTelegramConfig } from "../lib/config.js";
import { processUpdate, type TelegramUpdate } from "../lib/bot.js";

/**
 * Webhook de Telegram: recibe cada mensaje o boton pulsado y lo procesa.
 *
 * Registralo una vez con:  npm run telegram:webhook -- https://TU-APP.vercel.app
 * (usa TELEGRAM_WEBHOOK_SECRET para que solo Telegram pueda llamarlo).
 *
 * Siempre responde 200 a Telegram (si no, reintenta el mismo mensaje una y otra vez).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Solo POST" });
  }

  const cfg = getTelegramConfig();
  if (!cfg.webhookSecret) {
    console.error("Falta TELEGRAM_WEBHOOK_SECRET: el webhook queda desactivado.");
    return res.status(500).json({ ok: false, error: "Webhook sin secreto configurado" });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== cfg.webhookSecret) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }

  const update = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as TelegramUpdate;
  const outcome = await processUpdate(update ?? {});
  return res.status(200).json({ ok: outcome !== "error", outcome });
}
