// ========================================
// SERVIDOR EXPRESS PARA BOT DE WHATSAPP
// ========================================

import express from 'express';
import cors from 'cors';
import qrcode from 'qrcode';
import { config } from './config.js';
import { startBaileys, resetSession, lastQr, sock, isConnected } from './baileys.js';
import { guardarEnGoogleSheet } from './sheets.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========================================
// RUTAS PRINCIPALES
// ========================================

/**
 * Ruta principal con información del bot
 */
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${config.BOT_CONFIG.empresa} - Bot WhatsApp</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          padding: 40px;
          max-width: 500px;
          width: 100%;
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          font-size: 28px;
        }
        .subtitle {
          color: #666;
          margin-bottom: 30px;
          font-size: 16px;
        }
        .status {
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 20px;
          font-weight: 500;
        }
        .status.connected {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .status.disconnected {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .links {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .btn {
          display: block;
          padding: 15px 25px;
          border-radius: 10px;
          text-decoration: none;
          text-align: center;
          font-weight: 600;
          transition: all 0.3s;
        }
        .btn-primary {
          background: #25D366;
          color: white;
        }
        .btn-primary:hover {
          background: #20BA5A;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(37, 211, 102, 0.4);
        }
        .btn-secondary {
          background: #667eea;
          color: white;
        }
        .btn-secondary:hover {
          background: #5568d3;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .btn-danger {
          background: #e74c3c;
          color: white;
        }
        .btn-danger:hover {
          background: #c0392b;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(231, 76, 60, 0.4);
        }
        .btn-info {
          background: #3498db;
          color: white;
        }
        .btn-info:hover {
          background: #2980b9;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(52, 152, 219, 0.4);
        }
        .footer {
          margin-top: 30px;
          text-align: center;
          color: #999;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏠 ${config.BOT_CONFIG.empresa}</h1>
        <p class="subtitle">Bot de WhatsApp con IA</p>
        
        <div class="status ${isConnected ? 'connected' : 'disconnected'}">
          Estado: ${isConnected ? '✅ Conectado' : '⚠️ Desconectado'}
        </div>
        
        <div class="links">
          <a href="/qr" class="btn btn-primary">📱 Ver QR</a>
          <a href="/registros" class="btn btn-secondary">📊 Registros</a>
          <a href="/json" class="btn btn-info">📄 Ver JSON</a>
          <a href="/health" class="btn btn-info">💚 Health Check</a>
          <a href="/reset" class="btn btn-danger">🔄 Resetear Sesión</a>
        </div>
        
        <div class="footer">
          Powered by Baileys + Google Sheets + Groq AI
        </div>
      </div>
    </body>
    </html>
  `);
});

/**
 * Endpoint para obtener el código QR
 */
app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>QR Code - ${config.BOT_CONFIG.empresa}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          h1 { color: #128C7E; margin-bottom: 20px; }
          .success { color: #25D366; font-size: 24px; margin: 20px 0; }
          a { color: #128C7E; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Bot Conectado</h1>
          <div class="success">WhatsApp está activo y funcionando</div>
          <a href="/">← Volver al inicio</a>
        </div>
      </body>
      </html>
    `);
  }

  if (!lastQr) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>QR Code - ${config.BOT_CONFIG.empresa}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          h1 { color: #e67e22; margin-bottom: 20px; }
          .warning { color: #f39c12; font-size: 18px; margin: 20px 0; }
          a { color: #e67e22; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⏳ Generando QR...</h1>
          <div class="warning">Espera unos segundos y recarga la página</div>
          <a href="/">← Volver al inicio</a>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const qrImage = await qrcode.toDataURL(lastQr);
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>QR Code - ${config.BOT_CONFIG.empresa}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          h1 { color: #667eea; margin-bottom: 20px; }
          img { border: 3px solid #667eea; border-radius: 10px; margin: 20px 0; }
          .instructions { color: #666; margin: 20px 0; line-height: 1.6; }
          a { color: #667eea; text-decoration: none; font-weight: bold; display: block; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 Escanea este QR</h1>
          <img src="${qrImage}" alt="QR Code" />
          <div class="instructions">
            1. Abre WhatsApp en tu teléfono<br>
            2. Ve a Dispositivos vinculados<br>
            3. Escanea este código QR
          </div>
          <a href="/">← Volver al inicio</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error generando QR');
  }
});

/**
 * Endpoint para resetear la sesión
 */
app.get('/reset', async (req, res) => {
  try {
    await resetSession();
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset - ${config.BOT_CONFIG.empresa}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          h1 { color: #e74c3c; margin-bottom: 20px; }
          .message { color: #666; font-size: 18px; margin: 20px 0; }
          a { color: #e74c3c; text-decoration: none; font-weight: bold; display: block; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Sesión reseteada</h1>
          <div class="message">Ahora ve a /qr para escanear el código QR nuevamente</div>
          <a href="/">← Volver al inicio</a>
          <a href="/qr">📱 Ver QR</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error al resetear la sesión');
  }
});

/**
 * Endpoint para ver registros desde Google Sheets
 */
app.get('/registros', async (req, res) => {
  if (!config.GOOGLE_SHEET_API) {
    return res.status(500).send('GOOGLE_SHEET_API no configurada');
  }

  try {
    const response = await fetch(`${config.GOOGLE_SHEET_API}?action=getCitas`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Error desconocido');
    }

    const citas = data.citas || [];

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Registros - ${config.BOT_CONFIG.empresa}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
          }
          .header {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 { color: #333; margin-bottom: 10px; }
          .total { color: #666; font-size: 18px; }
          table {
            width: 100%;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          th, td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #eee;
          }
          th {
            background: #667eea;
            color: white;
            font-weight: 600;
          }
          tr:hover { background: #f9f9f9; }
          a {
            display: inline-block;
            margin-top: 20px;
            color: #667eea;
            text-decoration: none;
            font-weight: bold;
          }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📊 Registros de Citas</h1>
          <div class="total">Total: ${citas.length} cita(s)</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Tipo</th>
              <th>Detalles</th>
            </tr>
          </thead>
          <tbody>
            ${citas.length === 0 ? 
              '<tr><td colspan="6" style="text-align:center;color:#999;padding:40px;">No hay citas registradas</td></tr>' :
              citas.map(cita => `
                <tr>
                  <td>${cita.fecha}</td>
                  <td>${cita.hora}</td>
                  <td>${cita.nombre}</td>
                  <td>${cita.telefono}</td>
                  <td>${cita.tipo_solicitud}</td>
                  <td>${cita.detalles}</td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>

        <a href="/">← Volver al inicio</a>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Error - Registros</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
          h1 { color: #e74c3c; }
          pre { background: #f8f8f8; padding: 20px; border-radius: 5px; text-align: left; overflow-x: auto; }
          a { color: #667eea; text-decoration: none; font-weight: bold; display: block; margin-top: 20px; }
        </style>
      </head>
      <body>
        <h1>❌ Error al obtener datos</h1>
        <pre>${error.message}</pre>
        <a href="/">← Volver al inicio</a>
      </body>
      </html>
    `);
  }
});

/**
 * Endpoint para ver datos en formato JSON
 */
app.get('/json', async (req, res) => {
  if (!config.GOOGLE_SHEET_API) {
    return res.json({ error: 'GOOGLE_SHEET_API no configurada' });
  }

  try {
    const response = await fetch(`${config.GOOGLE_SHEET_API}?action=getCitas`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// HEALTH CHECK Y MONITORING
// ========================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const status = {
    status: isConnected ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    config: {
      empresa: config.BOT_CONFIG.empresa,
      vendedor: config.BOT_CONFIG.vendedor
    }
  };
  
  res.json(status);
});

/**
 * Ping interno cada 5 minutos para mantener activo
 */
setInterval(() => {
  console.log('🏓 Ping interno - Manteniendo servicio activo');
  
  // Si no está conectado, solo logear (el monitor interno se encarga de reconectar)
  if (!isConnected) {
    console.log('⚠️ Bot desconectado - El monitor interno intentará reconectar');
  }
}, 300000); // Cada 5 minutos


console.log('🏥 Health check disponible en /health');

// ========================================
// INICIAR SERVIDOR
// ========================================

const PORT = config.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  
  // Iniciar Baileys
  await startBaileys();
});
