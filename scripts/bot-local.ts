/**
 * Simula un comando o un boton del bot en local, sin Telegram ni Vercel.
 *
 *   npm run bot -- "/buscar Alajuela"
 *   npm run bot -- /estado
 *   npm run bot -- "@loc:0"        simula pulsar el boton con callback_data "loc:0"
 *
 * Usa el mismo almacen que `npm run check` (.state/ en local, Upstash si esta
 * configurado), asi que puedes alternar comandos y corridas para ver el efecto.
 */
import "dotenv/config";
import { handleCommand, handleCallback } from "../lib/commands.js";
import type { InlineKeyboard } from "../lib/keyboards.js";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Uso: npm run bot -- "/buscar Alajuela"   |   npm run bot -- "@loc:go"');
  process.exit(1);
}

const plain = (s: string) => s.replace(/<[^>]+>/g, "");
const showKeyboard = (k?: InlineKeyboard) => {
  if (!k) return;
  for (const row of k.inline_keyboard) console.log("  [" + row.map((b) => b.text).join("]  [") + "]");
};

if (text.startsWith("@")) {
  const r = await handleCallback(text.slice(1));
  if (r.toast) console.log(`(toast) ${r.toast}`);
  if (r.edit) {
    console.log("(edita el mensaje)\n" + plain(r.edit.text));
    showKeyboard(r.edit.replyMarkup);
  }
  if (r.send) {
    console.log("(mensaje nuevo)\n" + plain(r.send.text));
    showKeyboard(r.send.replyMarkup);
  }
} else {
  const reply = await handleCommand(text);
  console.log(plain(reply.text));
  showKeyboard(reply.replyMarkup);
}
