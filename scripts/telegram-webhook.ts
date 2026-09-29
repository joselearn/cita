/**
 * Registra (o borra) el webhook del bot en Telegram y publica el menu de comandos.
 *
 *   npm run telegram:webhook -- https://TU-APP.vercel.app     registra
 *   npm run telegram:webhook -- --info                        muestra el estado actual
 *   npm run telegram:webhook -- --delete                      borra el webhook
 *
 * Necesita TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en .env (el mismo secreto
 * que configures en Vercel).
 */
import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const arg = process.argv[2]?.trim();

if (!token) {
  console.error("Falta TELEGRAM_BOT_TOKEN en .env");
  process.exit(1);
}

async function api(method: string, body?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

if (!arg || arg === "--help") {
  console.log("Uso: npm run telegram:webhook -- https://TU-APP.vercel.app | --info | --delete");
  process.exit(1);
}

if (arg === "--info") {
  console.log(JSON.stringify(await api("getWebhookInfo"), null, 2));
} else if (arg === "--delete") {
  await api("deleteWebhook", { drop_pending_updates: true });
  console.log("Webhook borrado.");
} else {
  if (!secret) {
    console.error("Falta TELEGRAM_WEBHOOK_SECRET en .env (invéntate un texto largo y ponlo tambien en Vercel).");
    process.exit(1);
  }
  const url = `${arg.replace(/\/+$/, "")}/api/telegram`;
  await api("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await api("setMyCommands", {
    commands: [
      { command: "menu", description: "Botones: estaciones, dias, empezar" },
      { command: "buscar", description: "Buscar citas, ej: /buscar Alajuela, Heredia" },
      { command: "parar", description: "Pausar la busqueda" },
      { command: "estado", description: "Ver como esta la busqueda" },
      { command: "dias", description: "Ventana de dias, ej: /dias 5" },
      { command: "horario", description: "Solo cupos entre horas, ej: /horario 6-10" },
      { command: "silencio", description: "No avisar de noche, ej: /silencio 22-6" },
      { command: "ubicaciones", description: "Estaciones disponibles" },
      { command: "ayuda", description: "Lista de comandos" },
    ],
  });
  console.log(`Webhook registrado en ${url}`);
  console.log("Menu de comandos publicado. Escribele /estado al bot para probar.");
}
