// ========================================
// BOT INMOBILIARIO - WHATSAPP
// Archivo principal
// ========================================

import express from "express";
import QRCode from "qrcode";
import { config, validarConfig } from './config.js';
import { startBaileys, restartBaileys, resetSession, lastQr, sock, isConnected } from './baileys.js';
import { leerGoogleSheet, generarTablaHTML } from './sheets.js';

const app = express();
app.use(express.json());

// Fix URLs duplicadas
app.use((req, _res, next) => {
  req.url = req.url.replace(/\/{2,}/g, "/");
  next();
});

// Helper para async handlers
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ========================================
// RUTAS
// ========================================

// Home
app.get("/", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot Inmobiliario</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #25D366; }
        .status { padding: 10px; border-radius: 5px; margin: 20px 0; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
        a { display: inline-block; margin: 5px; padding: 10px 15px; background: #25D366; 
            color: white; text-decoration: none; border-radius: 5px; }
        a:hover { background: #128C7E; }
        .danger { background: #dc3545; }
        .danger:hover { background: #c82333; }
      </style>
    </head>
    <body>
      <h1>🏠 ${config.BOT_CONFIG.empresa}</h1>
      <p>Bot de WhatsApp con IA</p>
      <div class="status ${isConnected ? 'connected' : 'disconnected'}">
        Estado: ${isConnected ? '✅ Conectado' : '⚠️ Desconectado'}
      </div>
      
      <h2>🔗 Enlaces:</h2>
      <div>
        <a href="/qr">📱 Ver QR</a>
        <a href="/registros">📊 Registros</a>
        <a href="/datos">📄 JSON</a>
        <a href="/health">💚 Health</a>
      </div>
      
      <h2>⚙️ Admin:</h2>
      <div>
        <a href="/restart">🔄 Reiniciar</a>
        <a href="/reset" class="danger">🔁 Reset</a>
      </div>
      
      <hr>
      <p><small>Powered by Baileys + Google Sheets + Groq AI</small></p>
    </body>
    </html>
  `);
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: isConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    config: {
      empresa: config.BOT_CONFIG.empresa,
      vendedor: config.BOT_CONFIG.vendedor
    }
  });
});

// Ver QR
app.get("/qr", asyncHandler(async (_req, res) => {
  if (!lastQr) {
    return res.send(`
      <h2>No hay QR disponible</h2>
      <p>Si ya estás conectado, no lo necesitas.</p>
      <p>Si necesitas reconectar: <a href="/reset">/reset</a></p>
      <p><a href="/">← Volver</a></p>
    `);
  }
  
  const dataUrl = await QRCode.toDataURL(lastQr);
  res.send(`
    <h2>📱 Escanea con WhatsApp</h2>
    <img src="${dataUrl}" style="max-width: 400px;" />
    <p>WhatsApp → Dispositivos vinculados → Vincular</p>
    <p><a href="/">← Volver</a></p>
  `);
}));

// Ver registros
app.get("/registros", asyncHandler(async (_req, res) => {
  const html = await generarTablaHTML();
  res.send(html);
}));

// Datos en JSON
app.get("/datos", asyncHandler(async (_req, res) => {
  const datos = await leerGoogleSheet();
  res.json(datos);
}));

// Reiniciar
app.get("/restart", asyncHandler(async (_req, res) => {
  await restartBaileys({ delayMs: 3000 });
  res.send('Reiniciando... <a href="/">← Volver</a>');
}));

// Reset
app.get("/reset", asyncHandler(async (_req, res) => {
  await resetSession();
  res.send('Sesión reseteada. <a href="/qr">Ver QR</a> | <a href="/">← Volver</a>');
}));

// Enviar mensaje (API)
app.post("/send", asyncHandler(async (req, res) => {
  const { to, text } = req.body || {};
  
  if (!sock || !isConnected) {
    return res.status(503).json({ ok: false, error: "Bot no conectado" });
  }
  
  if (!to || !text) {
    return res.status(400).json({ ok: false, error: "Faltan parámetros" });
  }
  
  await sock.sendMessage(to, { text });
  res.json({ ok: true });
}));

// Error handler
app.use((err, _req, res, _next) => {
  console.error("❌ ERROR:", err);
  res.status(500).send(err?.message || "Error interno");
});

// ========================================
// INICIAR SERVIDOR
// ========================================
app.listen(config.PORT, "0.0.0.0", () => {
  console.log("=".repeat(60));
  console.log(`🏠 ${config.BOT_CONFIG.empresa.toUpperCase()}`);
  console.log("📱 Bot de WhatsApp con IA");
  console.log(`🚀 Puerto: ${config.PORT}`);
  console.log(`🌐 Entorno: ${config.NODE_ENV}`);
  console.log("=".repeat(60));
  
  validarConfig();
  
  startBaileys().catch((e) => {
    console.error("❌ Error al iniciar:", e);
    process.exit(1);
  });
});
