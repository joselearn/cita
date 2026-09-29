/**
 * Ejecucion local para probar sin desplegar.
 *   1. Copia .env.example a .env y llenalo.
 *   2. npm install
 *   3. npm run check
 */
import "dotenv/config";
import { run } from "../lib/run.js";

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    const modo = result.mode === "window" ? `window (hoy a +${result.windowDays} dias)` : result.mode;
    console.log(
      `\nModo: ${modo}  |  Dedup backend: ${result.dedupBackend}  |  Canales: ${result.channels.join(", ")}`,
    );
    if (result.skipped === "paused") {
      console.log('Busqueda EN PAUSA por el bot. Activa con: npm run bot -- /buscar');
      return;
    }
    if (result.skipped === "locked") {
      console.log("Corrida saltada: otra estaba en curso.");
      return;
    }
    for (const loc of result.locations) {
      const detalle =
        result.mode === "earliest"
          ? `cita mas proxima con cupos: ${loc.earliestAvailable ?? "-"}`
          : `con cupos: [${loc.availableTargetDates.join(", ") || "-"}]`;
      const nuevo = loc.newlyNotified
        .map((n) => `${n.date} (${n.times.length} cupos)`)
        .join(", ");
      console.log(
        loc.error
          ? `  ${loc.name}: ERROR ${loc.error}`
          : `  ${loc.name}: ${loc.totalAvailableDays} dias (nivel dia) | ${detalle}` +
              (nuevo ? `  -> NUEVO: ${nuevo}` : ""),
      );
    }
    console.log(
      result.notifiedVia.length > 0
        ? `\nAviso enviado por: ${result.notifiedVia.join(", ")}.`
        : result.deferred > 0
          ? `\n${result.deferred} aviso(s) guardados: estamos en horas de silencio.`
          : "\nSin novedades: no se envio ningun aviso.",
    );
    console.log(`Duracion: ${result.durationMs} ms`);
  })
  .catch((err) => {
    console.error("Fallo la verificacion:", err);
    process.exit(1);
  });
