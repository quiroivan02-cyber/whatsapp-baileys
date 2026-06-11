/**
 * Render.com (y similares):
 * - Plan gratis: el contenedor se suspende sin tráfico HTTP; mientras duerme, el WebSocket de
 *   WhatsApp se cae y los mensajes no se atienden en tiempo real. La sesión ahora vive en
 *   Postgres (tabla whatsapp_auth), así que al despertar reconecta SIN re-escanear el QR,
 *   pero para 24/7 real hace falta una instancia siempre activa (plan pago) o un VPS.
 * - Mitigación parcial: servicio externo que haga GET a /health cada ~10–14 min.
 */
import app from "./app.js";
import { config, validateConfig } from "./config/config.js";
import { initDatabase } from "./services/database.service.js";
import { startBaileys } from "./services/baileys.service.js";

async function bootstrap() {
  validateConfig();

  // El servidor HTTP arranca primero para que /health responda durante el deploy de Render.
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

  // La sesión de Baileys depende de Postgres: sin DB no hay sesión persistente.
  try {
    await initDatabase();
  } catch (err) {
    console.error(
      "💥 No se pudo inicializar Postgres. Revisa DATABASE_URL (Neon/Supabase/Render).",
      err
    );
    process.exit(1);
  }

  startBaileys().catch((err) => console.error("💥 Error al iniciar Baileys:", err));
}

bootstrap();
