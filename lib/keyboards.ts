import { getLocations } from "./config.js";
import { isSelected, MAX_LOCATIONS, type Control } from "./control.js";

/** Un boton de Telegram: abre una URL o manda un `callback_data` al bot. */
export interface Button {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboard {
  inline_keyboard: Button[][];
}

/** Teclado para elegir estaciones (hasta MAX_LOCATIONS), en filas de 2. */
export function stationsKeyboard(control: Control): InlineKeyboard {
  const rows: Button[][] = [];
  const all = getLocations();
  for (let i = 0; i < all.length; i += 2) {
    rows.push(
      all.slice(i, i + 2).map((l, j) => ({
        text: `${isSelected(control, l.name) ? "✅ " : ""}${l.name}`,
        callback_data: `loc:${i + j}`,
      })),
    );
  }
  const n = (control.locations ?? []).length;
  rows.push([
    { text: `Siguiente ▶️ (${n}/${MAX_LOCATIONS})`, callback_data: "loc:go" },
    { text: "🧹 Limpiar", callback_data: "loc:clear" },
  ]);
  return { inline_keyboard: rows };
}

/** Texto que acompaña al teclado de estaciones. */
export function stationsText(control: Control): string {
  const chosen = (control.locations ?? []).join(", ") || "ninguna";
  return (
    `📍 <b>Elige hasta ${MAX_LOCATIONS} estaciones</b> y pulsa Siguiente.\n` +
    `Elegidas: ${chosen}`
  );
}

/** Teclado para elegir la ventana de dias. */
export function daysKeyboard(control: Control): InlineKeyboard {
  const mark = (n: number) => (control.windowDays === n ? "✅ " : "");
  return {
    inline_keyboard: [
      [
        { text: `${mark(1)}Hoy y mañana`, callback_data: "dias:1" },
        { text: `${mark(3)}3 dias`, callback_data: "dias:3" },
      ],
      [
        { text: `${mark(7)}7 dias`, callback_data: "dias:7" },
        { text: `${mark(14)}14 dias`, callback_data: "dias:14" },
      ],
      [{ text: `${mark(0)}Solo la cita mas proxima`, callback_data: "dias:0" }],
    ],
  };
}

/**
 * Teclado del flujo de inicio: elegir hasta cuantos dias adelante buscar y
 * arrancar de una vez (callback "go:N").
 */
export function daysGoKeyboard(control: Control): InlineKeyboard {
  const mark = (n: number) => (control.windowDays === n ? "✅ " : "");
  const b = (n: number, text: string) => ({ text: `${mark(n)}${text}`, callback_data: `go:${n}` });
  return {
    inline_keyboard: [
      [b(1, "Hoy y mañana"), b(2, "2 dias"), b(3, "3 dias")],
      [b(4, "4 dias"), b(5, "5 dias"), b(7, "7 dias")],
      [b(10, "10 dias"), b(14, "14 dias")],
      [b(0, "Solo la cita mas proxima")],
      [{ text: "◀️ Cambiar estaciones", callback_data: "menu:loc" }],
    ],
  };
}

export function daysGoText(control: Control): string {
  const chosen = (control.locations ?? []).join(", ");
  return (
    `📍 Estaciones: <b>${chosen}</b>\n\n` +
    `📅 <b>¿Hasta cuantos dias adelante busco?</b>\n` +
    `Te aviso de cualquier cupo nuevo entre hoy y ese limite. ` +
    `Elige un boton o escribe el numero (ej. <code>5</code>) y empiezo.`
  );
}

export function daysText(control: Control): string {
  return (
    `📅 <b>¿Con cuanta anticipacion?</b>\n` +
    `Te aviso de cualquier cupo nuevo entre hoy y el limite que elijas.\n` +
    `Actual: ${control.windowDays > 0 ? `hoy a +${control.windowDays} dias` : "cita mas proxima"}`
  );
}

/** Menu principal (bienvenida y /menu). */
export function menuKeyboard(control: Control): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "📍 Elegir estaciones", callback_data: "menu:loc" }],
      [{ text: "📅 Elegir dias", callback_data: "menu:dias" }],
      [
        control.active
          ? { text: "⏸ Parar busqueda", callback_data: "stop" }
          : { text: "▶️ Empezar a buscar", callback_data: "menu:go" },
      ],
      [{ text: "ℹ️ Estado", callback_data: "menu:estado" }],
    ],
  };
}

/** Boton que acompaña a cada aviso de citas. */
export function notificationExtraRow(): Button[] {
  return [{ text: "✅ Ya reserve, parar busqueda", callback_data: "stop" }];
}
