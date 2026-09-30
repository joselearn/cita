// ==UserScript==
// @name         DEKRA rapido
// @namespace    https://github.com/joselearn/cita
// @version      1.2.0
// @description  Al abrir un link rapido del bot (#cita=FECHA T HORA) elige vehiculo, dia y hora, y rellena tus datos en el formulario de DEKRA. Tu resuelves el captcha y confirmas.
// @match        https://booking.dekra.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://cita-azure.vercel.app/dekra-rapido.user.js
// @updateURL    https://cita-azure.vercel.app/dekra-rapido.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuracion
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = "dekraRapido.datos";
  const POLL_MS = 350;
  const GIVE_UP_MS = 120_000;
  /** Abreviaturas que usa el calendario de DEKRA en el encabezado ("OCT. 2026"). */
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  /**
   * Campos del formulario de DEKRA. `selector` es el exacto (mapeado el 2026-09-30);
   * `match` es el respaldo por etiqueta si DEKRA cambia los nombres.
   */
  const CAMPOS = [
    { key: "placa", label: "Placa del vehiculo", selector: "input.rego-input", match: /placa/i, tipo: "text", ayuda: "sin guiones ni espacios, ej. ABC123" },
    { key: "nombre", label: "Nombre", selector: "input[formcontrolname=customerFirstName]", match: /^nombre/i, tipo: "text" },
    { key: "apellido", label: "Apellido", selector: "input[formcontrolname=customerLastName]", match: /apellido/i, tipo: "text" },
    { key: "correo", label: "Correo electronico", selector: "input[formcontrolname=customerEmailAddress]", match: /correo|email/i, tipo: "email" },
    { key: "telefono", label: "Telefono (8 digitos)", selector: "input[formcontrolname=customerPhoneNumber]", match: /tel[eé]fono/i, tipo: "tel" },
    { key: "vehiculo", label: "Tipo de vehiculo", match: null, tipo: "text", ayuda: "tal como aparece en DEKRA", def: "AUTOMÓVIL" },
  ];

  /** Input de un campo: primero por selector exacto, luego por etiqueta. */
  function inputFor(panel, campo) {
    if (campo.selector) {
      const el = all(campo.selector, panel).find(visible);
      if (el) return el;
    }
    return campo.match ? inputForLabel(panel, campo.match) : null;
  }

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) =>
    !!el && el instanceof Element && (el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) : el.getBoundingClientRect().height > 0);
  const all = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Panel del paso activo del stepper de DEKRA (los 5 pasos existen en el DOM; solo uno se ve). */
  function activePanel() {
    const panels = all(".mat-horizontal-stepper-content");
    const idx = panels.findIndex(visible);
    return { idx, panel: panels[idx] || null };
  }

  function click(el) {
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }

  function nextButton(panel) {
    return all("button", panel).find((b) => visible(b) && /^siguiente/.test(norm(b.textContent)) && !b.disabled);
  }

  /** Escribe en un input de Angular: valor + eventos para que el formulario lo registre. */
  function fill(input, value) {
    if (!input || value == null || input.value === value) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  /** Input asociado a una etiqueta cuyo texto cumple `re`, dentro del panel. */
  function inputForLabel(panel, re) {
    const labels = all("label, mat-label, p, span, div", panel).filter((el) => {
      if (!visible(el) || el.children.length > 2) return false;
      const t = norm(el.textContent);
      return t.length > 0 && t.length < 60 && re.test(t) && !el.querySelector("input");
    });
    for (const label of labels) {
      if (label.htmlFor) {
        const byId = document.getElementById(label.htmlFor);
        if (byId && visible(byId)) return byId;
      }
      const ff = label.closest("mat-form-field");
      if (ff) {
        const inp = ff.querySelector("input");
        if (inp && visible(inp)) return inp;
      }
      // El input suele venir despues de la etiqueta: en su bloque, en el siguiente, o en el del padre.
      let node = label;
      for (let i = 0; i < 6 && node; i++) {
        const candidates = all("input:not([type=hidden]):not([type=checkbox]):not([type=radio])", node).filter(visible);
        const after = candidates.find((inp) => label.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (after) return after;
        node = node.nextElementSibling || node.parentElement;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Datos personales (guardados solo en este navegador)
  // ---------------------------------------------------------------------------
  function loadData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }
  const saveData = (d) => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));

  /**
   * Franja inferior con el progreso. Siempre lleva el boton "Mis datos" para cambiar
   * placa, nombre, etc., y una X para cerrarla.
   */
  function banner(text, color) {
    let el = document.getElementById("dekra-rapido-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "dekra-rapido-banner";
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;gap:10px;padding:10px 12px;" +
        "font:14px system-ui,sans-serif;color:#fff;box-shadow:0 -2px 8px rgba(0,0,0,.2)";
      const msg = document.createElement("span");
      msg.id = "dekra-rapido-msg";
      msg.style.cssText = "flex:1;text-align:left";
      const edit = document.createElement("button");
      edit.textContent = "✏️ Mis datos";
      edit.style.cssText = "padding:8px 10px;border:0;border-radius:8px;background:rgba(255,255,255,.22);color:#fff;font-size:13px;white-space:nowrap";
      edit.onclick = () => askData(loadData(), (d) => (data = d));
      const close = document.createElement("button");
      close.textContent = "✕";
      close.setAttribute("aria-label", "Cerrar");
      close.style.cssText = "padding:8px 10px;border:0;border-radius:8px;background:transparent;color:#fff;font-size:15px";
      close.onclick = () => el.remove();
      el.append(msg, edit, close);
      document.body.appendChild(el);
    }
    el.style.background = color || "#0a7d2c";
    el.querySelector("#dekra-rapido-msg").textContent = `⚡ ${text}`;
  }

  function askData(existing, onDone) {
    if (document.getElementById("dekra-rapido-form")) return;
    const d = existing || {};
    const wrap = document.createElement("div");
    wrap.id = "dekra-rapido-form";
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:15px system-ui,sans-serif";
    const esc = (s) => String(s ?? "").replace(/"/g, "&quot;");
    const rows = CAMPOS.map(
      (c) =>
        `<label style="display:block;margin:8px 0 2px;font-weight:600">${c.label}</label>` +
        `<input data-key="${c.key}" type="${c.tipo}" value="${esc(d[c.key] ?? c.def ?? "")}" placeholder="${c.ayuda || ""}" ` +
        `autocomplete="off" style="width:100%;padding:10px;border:1px solid #bbb;border-radius:8px;font-size:16px;box-sizing:border-box">`,
    ).join("");
    wrap.innerHTML =
      `<div style="background:#fff;color:#222;border-radius:14px;padding:18px;width:min(92vw,420px);max-height:90vh;overflow:auto">` +
      `<h3 style="margin:0 0 6px;color:#0a7d2c">⚡ DEKRA rapido</h3>` +
      `<p style="margin:0 0 6px;font-size:13px;color:#555">Estos datos se guardan solo en este dispositivo y se usan para rellenar el formulario de DEKRA por ti.</p>` +
      rows +
      `<div style="display:flex;gap:8px;margin-top:14px">` +
      `<button id="dr-save" style="flex:1;padding:12px;background:#0a7d2c;color:#fff;border:0;border-radius:8px;font-size:16px">Guardar</button>` +
      `<button id="dr-cancel" style="padding:12px;background:#eee;border:0;border-radius:8px;font-size:16px">Ahora no</button>` +
      `</div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#dr-cancel").onclick = () => wrap.remove();
    wrap.querySelector("#dr-save").onclick = () => {
      const out = {};
      wrap.querySelectorAll("input[data-key]").forEach((i) => (out[i.dataset.key] = i.value.trim()));
      if (!out.placa || !out.nombre || !out.apellido || !out.correo || !out.telefono) {
        alert("Faltan datos. Llena todos los campos.");
        return;
      }
      saveData(out);
      wrap.remove();
      onDone(out);
    };
  }

  // ---------------------------------------------------------------------------
  // Objetivo: #cita=2026-10-12T06:35 (hora local)
  // ---------------------------------------------------------------------------
  function parseTarget() {
    const m = /cita=(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(location.hash);
    if (!m) return null;
    return { year: +m[1], month: +m[2], day: +m[3], hhmm: `${m[4]}:${m[5]}`, aria: `${m[2]}/${m[3]}/${m[1]}` };
  }

  // ---------------------------------------------------------------------------
  // Pasos (indice del panel activo: 0 vehiculo, 1 estacion, 2 dia y hora, 3 datos, 4 confirmacion)
  // ---------------------------------------------------------------------------
  const done = { vehicle: false, day: false, time: false, afterTime: false, form: false, asked: false };
  let data = loadData();
  const target = parseTarget();
  const startedAt = Date.now();
  let lastClickAt = 0;
  let monthClicks = 0;
  /** Cuando se cambio de mes por ultima vez: hay que dejar que DEKRA cargue la disponibilidad. */
  let monthChangedAt = 0;
  let dayClickedAt = 0;
  let dayRetries = 0;
  const throttle = (ms) => {
    if (Date.now() - lastClickAt < ms) return false;
    lastClickAt = Date.now();
    return true;
  };

  function stepVehicle(panel) {
    const wanted = norm((data && data.vehiculo) || "AUTOMÓVIL");
    // DEKRA marca la tarjeta elegida con "selected-product" y la lista en ".selected-product-item".
    const selected = all("mat-card.selected-product, .selected-product-item", panel).some((e) => norm(e.textContent).includes(wanted));
    if (!done.vehicle && !selected) {
      const card = all("mat-card.product, mat-card", panel).find((c) => visible(c) && norm(c.textContent) === wanted);
      if (card && throttle(600)) {
        click(card);
        done.vehicle = true;
        banner(`vehiculo: ${(data && data.vehiculo) || "AUTOMÓVIL"}`);
        return;
      }
      if (!card) banner(`no encuentro el tipo de vehiculo "${(data && data.vehiculo) || "AUTOMÓVIL"}"; eligelo tu`, "#b35c00");
      return;
    }
    if (throttle(800)) click(nextButton(panel));
  }

  function stepStation(panel) {
    // La estacion viene preseleccionada en el link. Solo avanzar.
    if (panel.querySelector(".selected-location") && throttle(800)) click(nextButton(panel));
  }

  function stepCalendar(panel) {
    if (!target) return;
    if (!done.day) {
      const cell = panel.querySelector(`button.mat-calendar-body-cell[aria-label^="${target.aria}"]`);
      if (cell) {
        // Tras cambiar de mes, DEKRA tarda en pintar la disponibilidad: esperar a que haya
        // celdas marcadas y a que pase un momento, si no el clic se pierde.
        const painted = panel.querySelector(".retail-available-date, .retail-not-available-date");
        if (!painted || Date.now() - monthChangedAt < 1500) return;
        if (cell.classList.contains("retail-not-available-date") || cell.disabled) {
          banner(`el ${target.day}/${target.month} ya no aparece disponible; elige otro dia`, "#b35c00");
          done.day = true;
          return;
        }
        if (throttle(500)) {
          click(cell);
          done.day = true;
          dayClickedAt = Date.now();
          banner(`dia ${target.day}/${target.month} elegido, buscando las ${target.hhmm}…`);
        }
        return;
      }
      // Otro mes: navegar con las flechas segun el encabezado "OCT. 2026".
      const period = panel.querySelector(".mat-calendar-period-button");
      const m = period && /^([a-z]{3})\.? (\d{4})$/.exec(norm(period.textContent));
      if (!m || monthClicks >= 6 || !throttle(900)) return;
      const current = +m[2] * 12 + MESES.indexOf(m[1]);
      const wanted = target.year * 12 + (target.month - 1);
      if (current === wanted) return; // el dia no existe en el mes (fecha rara): no hacer nada
      click(panel.querySelector(wanted > current ? ".mat-calendar-next-button" : ".mat-calendar-previous-button"));
      monthClicks++;
      monthChangedAt = Date.now();
      return;
    }
    if (!done.time) {
      const options = all("mat-radio-button.time-slot-option", panel).filter(visible);
      const opt = options.find((o) => norm(o.textContent) === target.hhmm);
      if (!opt) {
        if (options.length > 0) {
          // Ya cargaron horarios y no esta el nuestro: avisar una vez.
          banner(`las ${target.hhmm} ya no estan; elige otra hora de la lista`, "#b35c00");
          done.time = true;
        } else if (Date.now() - dayClickedAt > 6000 && dayRetries < 2) {
          // No cargaron horarios: volver a tocar el dia.
          dayRetries++;
          done.day = false;
          banner(`las horas no cargaron; vuelvo a tocar el dia ${target.day} (intento ${dayRetries + 1})`, "#b35c00");
        }
        return;
      }
      if (throttle(500)) {
        click(opt.querySelector("label.mat-radio-label") || opt);
        done.time = true;
        banner(`hora ${target.hhmm} apartada; tienes 5 minutos. Pasando al formulario…`);
      }
      return;
    }
    if (!done.afterTime && throttle(1200)) {
      const next = nextButton(panel);
      if (next) {
        click(next);
        done.afterTime = true;
      }
    }
  }

  function stepForm(panel) {
    if (done.form) return;
    const placa = inputFor(panel, CAMPOS[0]);
    if (!placa) return; // todavia no cargo el formulario
    if (!data) {
      if (!done.asked) {
        done.asked = true;
        banner("primera vez: guarda tus datos y los relleno", "#b35c00");
        askData(null, (d) => {
          data = d;
        });
      }
      return;
    }
    let ok = 0;
    let missing = [];
    for (const c of CAMPOS) {
      if (!c.match) continue;
      const input = inputFor(panel, c);
      if (!input) {
        missing.push(c.label);
        continue;
      }
      fill(input, data[c.key]);
      if (input.value === data[c.key]) ok++;
    }
    if (ok >= 3) {
      done.form = true;
      const extra = missing.length ? ` No encontre: ${missing.join(", ")}.` : "";
      banner(`datos rellenados.${extra} Marca las casillas, resuelve el captcha y confirma.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Bucle
  // ---------------------------------------------------------------------------
  if (target) banner(`objetivo ${target.day}/${target.month} a las ${target.hhmm}. Haciendo los clics…`);
  else banner(data ? "listo para rellenar el formulario cuando llegues a el." : "sin datos guardados: toca Mis datos.", data ? "#0a7d2c" : "#b35c00");

  const timer = setInterval(() => {
    try {
      const { idx, panel } = activePanel();
      if (!panel) return;
      if (target) {
        if (idx === 0) stepVehicle(panel);
        else if (idx === 1) stepStation(panel);
        else if (idx === 2) stepCalendar(panel);
      }
      if (idx === 3) stepForm(panel);
      if (done.form || Date.now() - startedAt > GIVE_UP_MS) clearInterval(timer);
    } catch (err) {
      console.warn("[DEKRA rapido]", err);
    }
  }, POLL_MS);

  // Para cambiar tus datos desde la consola: dekraRapidoDatos()
  window.dekraRapidoDatos = () => askData(loadData(), (d) => (data = d));
})();
