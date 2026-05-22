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
    console.log(`\nModo: ${result.mode}  |  Dedup backend: ${result.dedupBackend}`);
    for (const loc of result.locations) {
      const detalle =
        result.mode === "target-dates"
          ? `objetivo disponibles: [${loc.availableTargetDates.join(", ") || "-"}]`
          : `cita mas proxima: ${loc.earliestAvailable ?? "-"}`;
      console.log(
        `  ${loc.name}: ${loc.totalAvailableDays} dias disponibles | ${detalle}` +
          (loc.newlyNotified.length ? `  -> NUEVO: ${loc.newlyNotified.join(", ")}` : ""),
      );
    }
    console.log(result.emailSent ? "\nCorreo enviado." : "\nSin novedades: no se envio correo.");
  })
  .catch((err) => {
    console.error("Fallo la verificacion:", err);
    process.exit(1);
  });
