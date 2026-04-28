import QRCode from "qrcode";
import { lastQr, isConnected, connectionStatus, resetSession } from "../services/baileys.service.js";
import { config } from "../config/config.js";

/**
 * Vista principal del Dashboard
 */
export function homePage(req, res) {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Panel | ${config.botConfig.company}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f7f6; color: #333; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .container { max-width: 450px; width: 90%; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; }
        .status-badge { padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 0.9em; display: inline-block; margin-bottom: 20px; }
        .online { background: #e6fffa; color: #2c7a7b; border: 1px solid #b2f5ea; }
        .offline { background: #fff5f5; color: #c53030; border: 1px solid #feb2b2; }
        .btn { display: block; width: 100%; padding: 12px; margin: 10px 0; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; font-size: 15px; font-weight: 600; transition: 0.3s; box-sizing: border-box; }
        .btn-primary { background: #4a5568; color: white; }
        .btn-primary:hover { background: #2d3748; }
        .btn-danger { background: #e53e3e; color: white; border: none; font-family: inherit; }
        .btn-danger:hover { background: #c53030; }
        .btn-ghost { background: #edf2f7; color: #4a5568; }
        hr { border: 0; border-top: 1px solid #eee; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="margin-bottom: 5px;">🤖 Panel de Control</h1>
        <p style="color: #718096; margin-bottom: 25px;">${config.botConfig.company}</p>
        
        <div class="status-badge ${isConnected ? 'online' : 'offline'}">
          ${isConnected ? '● DISPOSITIVO VINCULADO' : '○ ESPERANDO CONEXIÓN'}
        </div>

        <div style="text-align: left; background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 5px 0;"><strong>Agente:</strong> ${config.botConfig.salesRep}</p>
          <p style="margin: 5px 0;"><strong>Entorno:</strong> ${config.nodeEnv}</p>
        </div>

        <a href="/qr" class="btn btn-primary">${isConnected ? 'Ver Estado de Conexión' : 'Escanear Código QR'}</a>
        <a href="/health" class="btn btn-ghost">Ver JSON Health</a>
        
        <hr>
        
        <form action="/reset" method="POST" onsubmit="return confirm('⚠️ ¿Estás seguro? Se borrará la sesión de la base de datos y tendrás que escanear el QR nuevamente.');">
          <button type="submit" class="btn btn-danger">Cerrar Sesión (Reset)</button>
        </form>
      </div>
    </body>
    </html>
  `);
}

/**
 * Vista del Código QR
 */
export async function qrPage(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  if (isConnected) {
    return res.send(`
      <script>setTimeout(() => { window.location.href = "/"; }, 2000);</script>
      <body style="text-align: center; font-family: sans-serif; padding-top: 100px; background: #f4f7f6;">
        <h1 style="color: #38a169;">✅ Conectado Correctamente</h1>
        <p>Redirigiendo al panel de control...</p>
      </body>
    `);
  }

  if (!lastQr) {
    return res.send(`
      <meta http-equiv="refresh" content="3">
      <body style="text-align: center; font-family: sans-serif; padding-top: 100px; background: #f4f7f6;">
        <div style="display: inline-block; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <h1>Generando QR...</h1>
            <p>Por favor espera un momento.</p>
        </div>
      </body>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(lastQr, {
      errorCorrectionLevel: "L",
      margin: 2,
      width: 320,
    });
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Vincular WhatsApp</title>
        <meta http-equiv="refresh" content="30">
        <style>
          body { text-align: center; font-family: 'Segoe UI', sans-serif; background: #f0f2f5; padding: 50px; }
          .card { background: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
          img { border: 10px solid #f0f2f5; border-radius: 10px; margin: 20px 0; }
          .btn-back { color: #4a5568; text-decoration: none; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Vincular dispositivo</h1>
          <p>Escanea el código para activar el bot de <strong>${config.botConfig.company}</strong></p>
          <img src="${qrImage}" alt="WhatsApp QR" />
          <p style="color: #718096;">El código expira y se actualiza automáticamente.</p>
          <br>
          <a href="/" class="btn-back">← Volver al inicio</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send("Error generando el código QR.");
  }
}

/**
 * Lógica para resetear la sesión
 */
export async function handleReset(req, res) {
  try {
    await resetSession();
    res.send(`
      <script>
        alert('Sesión eliminada con éxito.');
        window.location.href = "/qr";
      </script>
    `);
  } catch (error) {
    console.error("Error en handleReset:", error);
    res.status(500).send("No se pudo reiniciar la sesión.");
  }
}

/**
 * Health Check para monitoreo
 */
export function healthCheck(req, res) {
  res.json({
    success: true,
    status: isConnected ? "connected" : "disconnected",
    connectionStatus: connectionStatus,
    company: config.botConfig.company,
    timestamp: new Date().toISOString()
  });
}