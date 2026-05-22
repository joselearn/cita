import { Resend } from "resend";
import { getEmailConfig, getBookingUrl } from "./config.js";

export interface DateSlots {
  date: string;
  /** Horas disponibles en formato ISO (UTC). Vacio si no se pudieron consultar. */
  times: string[];
}

export interface LocationNotification {
  locationName: string;
  locationId: string;
  dates: DateSlots[];
}

const TIME_ZONE = process.env.TIME_ZONE?.trim() || "America/Costa_Rica";

/** Formatea una hora ISO (UTC) a la hora local de Costa Rica, ej. "9:35 a. m.". */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CR", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Envia un unico correo con las novedades de todas las ubicaciones. */
export async function sendAvailabilityEmail(
  notifications: LocationNotification[],
  mode: "target-dates" | "earliest" = "target-dates",
): Promise<void> {
  const emailConfig = getEmailConfig();
  const resend = new Resend(emailConfig.apiKey);

  const isEarliest = mode === "earliest";
  const intro = isEarliest
    ? "Estas son las citas mas proximas que acaban de habilitarse:"
    : "Se habilito disponibilidad en las fechas que te interesan:";

  // Para el asunto: "Alajuela (2026-05-22), Puntarenas (2026-06-01)"
  const summary = notifications
    .map((n) => `${n.locationName} (${n.dates.map((d) => d.date).join(", ")})`)
    .join(", ");
  const subject = `Cita DEKRA disponible: ${summary}`;

  const blocks = notifications
    .map((n) => {
      const bookingUrl = getBookingUrl(n.locationId);
      const list = n.dates
        .map((d) => {
          const times = d.times.length
            ? `<span style="color:#444;"> — ${d.times.length} cupo(s): ${d.times
                .map(formatTime)
                .join(", ")}</span>`
            : "";
          return `<li><a href="${bookingUrl}" style="color:#0a7d2c;font-weight:bold;">${d.date}</a>${times}</li>`;
        })
        .join("");
      return `
        <div style="margin:0 0 18px 0;">
          <h3 style="margin:0 0 6px 0;">${n.locationName}</h3>
          <ul style="margin:0 0 8px 0;">${list}</ul>
          <a href="${bookingUrl}"
             style="display:inline-block;padding:8px 16px;background:#0a7d2c;color:#fff;text-decoration:none;border-radius:6px;">
             Reservar en ${n.locationName}
          </a>
        </div>`;
    })
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 15px; color: #222;">
      <h2>Hay citas disponibles en DEKRA</h2>
      <p>${intro}</p>
      ${blocks}
      <p style="color:#888;font-size:12px;">Aviso automatico generado por tu DEKRA Watcher.</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: emailConfig.from,
    to: emailConfig.to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend fallo al enviar el correo: ${JSON.stringify(error)}`);
  }
}
