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
