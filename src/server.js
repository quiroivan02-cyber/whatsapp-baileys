/**
 * Render.com (y similares):
 * - Plan gratis: el contenedor se suspende sin tráfico HTTP; al despertar la sesión de WhatsApp puede romperse.
 *   Para 24/7 real usa plan con instancia siempre activa o un VPS.
 * - Mitigación parcial: servicio externo que haga GET a /health cada ~10–14 min (no garantiza socket estable).
 * - Sin disco persistente, al reiniciar se pierde auth_info_baileys: en Render añade Disk y BAILEYS_AUTH_DIR=/ruta/montaje.
 */
import app from "./app.js";
import { config } from "./config/config.js";
import { startBaileys } from "./services/baileys.service.js";

startBaileys().catch((err) => console.error("💥 Error al iniciar Baileys:", err));

const server = app.listen(config.port, () => {
  console.log(`🌐 Dashboard disponible en http://localhost:${config.port}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `❌ El puerto ${config.port} ya está en uso (¿otra ventana con npm start / node?).\n` +
        `   Libera el puerto:  fuser -k ${config.port}/tcp\n` +
        `   O usa otro:        PORT=3001 npm start`
    );
    process.exit(1);
  }
  throw err;
});
