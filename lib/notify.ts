import { sendAvailabilityEmail, type LocationNotification } from "./email.js";
import { sendAvailabilityTelegram } from "./telegram.js";
import { getNotifyChannels, type NotifyChannel, type NotifyMode } from "./config.js";
import type { SentMessage } from "./dedup.js";

export interface NotifyResult {
  sentVia: NotifyChannel[];
  /** Mensajes de Telegram enviados (para poder editarlos despues). */
  telegramMessages: SentMessage[];
}

/**
 * Envia el aviso por todos los canales configurados (correo, Telegram o ambos).
 * Si un canal falla, igual se intentan los demas y al final se lanza un error
 * con el detalle de los que fallaron.
 */
export async function notify(notifications: LocationNotification[], mode: NotifyMode): Promise<NotifyResult> {
  const channels = getNotifyChannels();
  const result: NotifyResult = { sentVia: [], telegramMessages: [] };
  const errors: string[] = [];

  for (const channel of channels) {
    try {
      if (channel === "email") {
        await sendAvailabilityEmail(notifications, mode);
      } else {
        result.telegramMessages.push(...(await sendAvailabilityTelegram(notifications, mode)));
      }
      result.sentVia.push(channel);
    } catch (err) {
      errors.push(`${channel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Fallo la notificacion por ${errors.length} canal(es). ${errors.join(" | ")}`);
  }
  return result;
}
