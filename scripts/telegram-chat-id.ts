/**
 * Obtiene tu TELEGRAM_CHAT_ID.
 *
 *   1. Pon TELEGRAM_BOT_TOKEN en .env (lo da @BotFather al crear el bot).
 *   2. Abre tu bot en Telegram y mandale cualquier mensaje (ej. "hola").
 *   3. npm run telegram:chatid
 *
 * Imprime los chats que le han escrito al bot con su id. Copia el tuyo a TELEGRAM_CHAT_ID.
 */
import "dotenv/config";

interface Update {
  message?: {
    chat: { id: number; type: string; first_name?: string; username?: string; title?: string };
    text?: string;
  };
}

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("Falta TELEGRAM_BOT_TOKEN en .env");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = (await res.json()) as { ok: boolean; description?: string; result?: Update[] };
if (!data.ok) {
  console.error("Telegram respondio con error:", data.description ?? res.status);
  process.exit(1);
}

const chats = new Map<number, string>();
for (const u of data.result ?? []) {
  const chat = u.message?.chat;
  if (!chat) continue;
  const name = chat.title ?? [chat.first_name, chat.username && `@${chat.username}`].filter(Boolean).join(" ");
  chats.set(chat.id, `${name || "(sin nombre)"} [${chat.type}]`);
}

if (chats.size === 0) {
  console.log("El bot todavia no ha recibido mensajes. Abre el bot en Telegram, escribele algo y vuelve a correr esto.");
} else {
  console.log("Chats que han escrito al bot:\n");
  for (const [id, name] of chats) console.log(`  TELEGRAM_CHAT_ID=${id}    (${name})`);
  console.log("\nCopia el tuyo a .env y al secreto TELEGRAM_CHAT_ID en GitHub.");
}
