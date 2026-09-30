import { getLocations } from "./config.js";
import {
  loadControl,
  saveControl,
  activate,
  findLocations,
  resolveLocations,
  toggleLocation,
  meansAll,
  MAX_LOCATIONS,
  EXPIRE_DAYS,
  type Control,
} from "./control.js";
import { loadState } from "./dedup.js";
import { loadEvents, computeStats, formatStats } from "./events.js";
import { formatDateTime, formatHourRange, parseHourRange } from "./time.js";
import {
  stationsKeyboard,
  stationsText,
  daysKeyboard,
  daysText,
  daysGoKeyboard,
  daysGoText,
  menuKeyboard,
  type InlineKeyboard,
} from "./keyboards.js";

/** Respuesta del bot: texto HTML y, opcionalmente, botones. */
export interface BotReply {
  text: string;
  replyMarkup?: InlineKeyboard;
}

/** Resultado de pulsar un boton. */
export interface CallbackResult {
  /** Aviso corto que Telegram muestra encima del boton. */
  toast?: string;
  /** Reemplaza el mensaje donde estaba el boton. */
  edit?: BotReply;
  /** Manda un mensaje nuevo. */
  send?: BotReply;
}

/** Texto de ayuda (HTML de Telegram). */
export const HELP_TEXT = [
  "<b>Comandos</b>",
  "/menu — botones para elegir estaciones, dias y empezar",
  `/buscar Alajuela — busca ahi (hasta ${MAX_LOCATIONS}: Alajuela, Heredia, Cartago)`,
  "/buscar — retoma la ultima busqueda",
  "/parar — pausa la busqueda",
  "/estado — como esta la busqueda ahora",
  "/dias 5 — vigila de hoy a +5 dias (0 = cita mas proxima)",
  "/horario 6-10 — solo cupos entre esas horas (/horario todo = cualquiera)",
  "/silencio 22-6 — no avisar de noche, lo manda en la mañana (/silencio no)",
  "/ubicaciones — lista las estaciones disponibles",
  "/horas — a que horas suelen aparecer cupos (ultimos 30 dias)",
  "/ayuda — este mensaje",
  "",
  "Los nombres pueden ir sin tildes y a medias: /buscar perez, guapiles",
].join("\n");

function describe(control: Control): string {
  const names = resolveLocations(control).map((l) => l.name);
  const window =
    control.windowDays > 0
      ? `hoy a +${control.windowDays} dias`
      : "cita mas proxima (o TARGET_DATES si esta definido)";
  const lines = [
    `Estaciones: ${names.length > 0 ? names.join(", ") : "ninguna elegida"}`,
    `Ventana: ${window}`,
  ];
  if (control.hours) lines.push(`Horario: solo cupos de ${formatHourRange(control.hours)}`);
  if (control.quiet) lines.push(`Silencio: de ${formatHourRange(control.quiet)} (te aviso despues)`);
  if (control.active && control.expiresAt) {
    lines.push(`Se apaga sola: ${formatDateTime(control.expiresAt)} (manda /buscar para renovar)`);
  }
  return lines.join("\n");
}

function locationsList(control: Control): string {
  const activas = new Set(control.active ? resolveLocations(control).map((l) => l.name) : []);
  return getLocations()
    .map((l) => `• ${l.name}${activas.has(l.name) ? " 👁" : ""}`)
    .join("\n");
}

function welcome(control: Control): BotReply {
  return {
    text:
      `👋 Hola. Soy tu vigilante de citas DEKRA.\n\n` +
      `Reviso las estaciones que elijas cada minuto y te aviso en cuanto se libere un cupo, ` +
      `con un boton para reservar. Cuando reserves, pulsa "Ya reserve" y dejo de buscar.\n\n` +
      `Empieza por elegir estaciones 👇 (o escribe /ayuda para ver los comandos).`,
    replyMarkup: menuKeyboard(control),
  };
}

/** Activa la busqueda si hay estaciones; devuelve la respuesta. */
async function startSearch(control: Control): Promise<BotReply> {
  if (resolveLocations(control).length === 0) {
    return { text: stationsText(control), replyMarkup: stationsKeyboard(control) };
  }
  activate(control);
  await saveControl(control);
  return {
    text: `🔎 <b>Buscando citas.</b> Te aviso en cuanto se libere una.\n${describe(control)}`,
  };
}

/** Paso previo a arrancar: con las estaciones ya elegidas, pregunta hasta cuantos dias. */
function askDays(control: Control): BotReply {
  if (resolveLocations(control).length === 0) {
    return { text: stationsText(control), replyMarkup: stationsKeyboard(control) };
  }
  return { text: daysGoText(control), replyMarkup: daysGoKeyboard(control) };
}

/** Fija la ventana de dias y arranca (respuesta a "go:N" o a escribir solo un numero). */
async function startWithDays(control: Control, n: number): Promise<BotReply> {
  control.windowDays = n;
  return startSearch(control);
}

/** True si el usuario esta en el paso de elegir dias (estaciones elegidas, aun no activo). */
function awaitingDays(control: Control): boolean {
  return !control.active && resolveLocations(control).length > 0;
}

async function stopSearch(control: Control): Promise<BotReply> {
  if (!control.active) return { text: "Ya estaba en pausa. Manda /buscar cuando quieras retomar." };
  control.active = false;
  await saveControl(control);
  return {
    text: "⏸ <b>Busqueda en pausa.</b> No consulto DEKRA ni te aviso hasta que mandes /buscar.",
  };
}

async function statusReply(control: Control): Promise<BotReply> {
  const state = await loadState();
  const head = !control.active
    ? "⏸ <b>En pausa.</b> Manda /buscar para empezar."
    : resolveLocations(control).length === 0
      ? `⚠️ <b>Activo pero sin estaciones elegidas.</b> Dime donde: <code>/buscar Alajuela</code>`
      : "🟢 <b>Activo:</b> buscando citas.";
  const lines = [head, describe(control)];
  if (state.lastCheckAt) {
    lines.push(`Ultima revision: ${formatDateTime(state.lastCheckAt)}`);
    if (state.lastSummary) lines.push(state.lastSummary);
  } else {
    lines.push("Todavia no ha corrido ninguna revision.");
  }
  if (state.failures.count > 0) {
    lines.push(
      `⚠️ ${state.failures.count} fallo(s) seguidos consultando DEKRA. Ultimo: ${state.failures.lastError ?? "?"}`,
    );
  }
  if (state.pending.length > 0) lines.push(`🔕 ${state.pending.length} aviso(s) esperando a que termine el silencio.`);
  return { text: lines.join("\n") };
}

/** Separa "/buscar Alajuela, Heredia" en comando y argumento. */
function parse(text: string): { cmd: string; arg: string } {
  const m = /^\/?([a-záéíóúñ]+)(?:@\w+)?\s*(.*)$/is.exec(text.trim());
  if (!m) return { cmd: "", arg: "" };
  return { cmd: m[1].toLowerCase(), arg: m[2].trim() };
}

/**
 * Interpreta un mensaje del usuario, aplica el cambio en el control y devuelve
 * la respuesta. No sabe nada de Telegram ni de HTTP, asi que se puede probar
 * en local con `npm run bot -- "/buscar Alajuela"`.
 */
export async function handleCommand(text: string): Promise<BotReply> {
  const { cmd, arg } = parse(text);
  const control = await loadControl();

  switch (cmd) {
    case "start":
      return welcome(control);

    case "menu":
      return { text: "¿Que quieres hacer?", replyMarkup: menuKeyboard(control) };

    case "ayuda":
    case "help":
      return { text: HELP_TEXT };

    case "buscar": {
      if (arg && meansAll(arg)) {
        return {
          text:
            `Para no saturar a DEKRA solo vigilo hasta ${MAX_LOCATIONS} estaciones a la vez. ` +
            `Elige las mas cercanas:`,
          replyMarkup: stationsKeyboard(control),
        };
      }
      if (arg) {
        const names = arg.split(/[,;]| y /i).map((s) => s.trim()).filter(Boolean);
        const { found, unknown, ambiguous } = findLocations(names);
        const problems: string[] = [];
        if (unknown.length > 0) problems.push(`No conozco: ${unknown.join(", ")}.`);
        for (const a of ambiguous) {
          problems.push(`"${a.name}" puede ser: ${a.options.map((o) => o.name).join(", ")}. Se mas especifico.`);
        }
        if (found.length > MAX_LOCATIONS) {
          problems.push(`Son ${found.length} estaciones y el maximo es ${MAX_LOCATIONS} a la vez. Quita alguna.`);
        }
        if (problems.length > 0) {
          return { text: `${problems.join("\n")}\n\n<b>Estaciones disponibles</b>\n${locationsList(control)}` };
        }
        control.locations = found.map((l) => l.name);
        control.active = false;
        await saveControl(control);
        // Estaciones listas: ahora pregunta hasta cuantos dias adelante.
        return askDays(control);
      }
      if (control.active && resolveLocations(control).length > 0) {
        return { text: `Ya estoy buscando.\n${describe(control)}` };
      }
      // /buscar a secas: retoma con lo ultimo elegido (o pide estaciones si no hay).
      return startSearch(control);
    }

    case "parar":
    case "stop":
    case "pausar":
      return stopSearch(control);

    case "estado":
    case "status":
      return statusReply(control);

    case "dias":
    case "ventana": {
      if (!arg) return { text: daysText(control), replyMarkup: daysKeyboard(control) };
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 0 || n > 60) return { text: "Dime cuantos dias, entre 0 y 60. Ej: /dias 5" };
      control.windowDays = n;
      await saveControl(control);
      return {
        text:
          n > 0
            ? `📅 Ventana: hoy a +${n} dias.${control.active ? "" : " (La busqueda sigue en pausa; manda /buscar.)"}`
            : "📅 Ventana desactivada: avisare de la cita mas proxima (o de TARGET_DATES si esta definido).",
      };
    }

    case "horario": {
      if (!arg) {
        return {
          text: control.hours
            ? `Horario actual: solo cupos de ${formatHourRange(control.hours)}.\nCambia con /horario 13-17 o quita con /horario todo.`
            : "Sin filtro de horario: cualquier hora sirve.\nPon uno con /horario 6-10 (solo cupos entre 6:00 y 10:00).",
        };
      }
      if (/^(todo|todos|cualquiera|no|quitar)$/i.test(arg)) {
        control.hours = null;
        await saveControl(control);
        return { text: "🕐 Sin filtro de horario: te aviso de cupos a cualquier hora." };
      }
      const range = parseHourRange(arg);
      if (!range || range.from > range.to) return { text: "Formato: /horario 6-10 (de 6:00 a 10:00). Ej: /horario 13-17" };
      control.hours = range;
      await saveControl(control);
      return { text: `🕐 Solo te avisare de cupos de ${formatHourRange(range)}.` };
    }

    case "silencio": {
      if (!arg) {
        return {
          text: control.quiet
            ? `Silencio actual: de ${formatHourRange(control.quiet)}. Quita con /silencio no.`
            : "Sin horas de silencio. Pon unas con /silencio 22-6 (los cupos de la noche te llegan a las 6).",
        };
      }
      if (/^(no|quitar|nunca|off)$/i.test(arg)) {
        control.quiet = null;
        await saveControl(control);
        return { text: "🔔 Sin horas de silencio: te aviso a cualquier hora." };
      }
      const range = parseHourRange(arg);
      if (!range) return { text: "Formato: /silencio 22-6 (no avisar de 22:00 a 6:00)." };
      control.quiet = range;
      await saveControl(control);
      return { text: `🔕 De ${formatHourRange(range)} no te aviso; lo que aparezca te llega junto al terminar.` };
    }

    case "ubicaciones":
    case "lugares":
    case "estaciones":
      return { text: stationsText(control), replyMarkup: stationsKeyboard(control) };

    case "horas":
    case "patron":
    case "estadisticas": {
      const days = /^\d{1,3}$/.test(arg) ? Math.min(Number(arg), 365) : 30;
      const stats = computeStats(await loadEvents(), days);
      return { text: formatStats(stats, days) };
    }

    default: {
      // Solo un numero: es la ventana de dias. Si estaba eligiendo, arranca; si ya
      // buscaba, solo la cambia.
      const n = Number(text.trim());
      if (/^\d{1,2}$/.test(text.trim()) && n <= 60 && resolveLocations(control).length > 0) {
        if (awaitingDays(control)) return startWithDays(control, n);
        control.windowDays = n;
        await saveControl(control);
        return { text: `📅 Ventana: ${n > 0 ? `hoy a +${n} dias` : "cita mas proxima"}. Sigo buscando.\n${describe(control)}` };
      }
      return { text: `No entendi "${text.trim().slice(0, 40)}".\n\n${HELP_TEXT}` };
    }
  }
}

/**
 * Procesa un boton pulsado (callback_data). Devuelve que hacer con el mensaje.
 */
export async function handleCallback(data: string): Promise<CallbackResult> {
  const control = await loadControl();
  const [kind, value] = data.split(":", 2);

  switch (kind) {
    case "loc": {
      if (value === "go") {
        if (resolveLocations(control).length === 0) return { toast: "Elige al menos una estacion." };
        // Siguiente paso: hasta cuantos dias adelante.
        return { edit: askDays(control) };
      }
      if (value === "clear") {
        control.locations = [];
        await saveControl(control);
        return { edit: { text: stationsText(control), replyMarkup: stationsKeyboard(control) } };
      }
      const loc = getLocations()[Number(value)];
      if (!loc) return { toast: "Esa estacion ya no existe." };
      if (!toggleLocation(control, loc.name)) {
        return { toast: `Maximo ${MAX_LOCATIONS} estaciones. Quita una primero.` };
      }
      await saveControl(control);
      return { edit: { text: stationsText(control), replyMarkup: stationsKeyboard(control) } };
    }

    case "go": {
      // Flujo de inicio: dias elegidos -> arranca.
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 60) return { toast: "Valor invalido." };
      if (resolveLocations(control).length === 0) return { toast: "Primero elige estaciones." };
      return { edit: await startWithDays(control, n) };
    }

    case "dias": {
      // Cambiar la ventana sin tocar el estado de la busqueda.
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 60) return { toast: "Valor invalido." };
      control.windowDays = n;
      await saveControl(control);
      const reply: BotReply = { text: daysText(control), replyMarkup: daysKeyboard(control) };
      if (!control.active) {
        reply.text += "\n\n¿Listo? Pulsa Empezar.";
        reply.replyMarkup = {
          inline_keyboard: [...daysKeyboard(control).inline_keyboard, [{ text: "▶️ Empezar a buscar", callback_data: "menu:go" }]],
        };
      }
      return { edit: reply };
    }

    case "menu": {
      if (value === "loc") return { edit: { text: stationsText(control), replyMarkup: stationsKeyboard(control) } };
      if (value === "dias") return { edit: { text: daysText(control), replyMarkup: daysKeyboard(control) } };
      if (value === "estado") return { send: await statusReply(control) };
      if (value === "go") return { edit: askDays(control) };
      return { toast: "Opcion desconocida." };
    }

    case "stop": {
      const reply = await stopSearch(control);
      return { toast: "Busqueda en pausa.", send: reply };
    }

    default:
      return { toast: "Boton desconocido." };
  }
}
