// ========================================
// INTEGRACIÓN CON GOOGLE SHEETS
// ========================================

import { config } from './config.js';

/**
 * Guarda datos en Google Sheets
 * @param {string} nombre - Nombre del contacto
 * @param {string} telefono - Número de teléfono
 * @param {string} tipoSolicitud - Tipo de solicitud
 * @param {string} detalles - Detalles adicionales (opcional, para citas)
 * @returns {Promise<Object>} Resultado de la operación
 */
export async function guardarEnGoogleSheet(nombre, telefono, tipoSolicitud, detalles = '') {
  if (!config.GOOGLE_SHEET_API) {
    console.log('⚠️ GOOGLE_SHEET_API no configurada');
    return { success: false, error: 'API no configurada' };
  }
  
  try {
    console.log('📊 Guardando en Google Sheets...');
    console.log('   Nombre:', nombre);
    console.log('   Teléfono:', telefono);
    console.log('   Tipo:', tipoSolicitud);
    if (detalles) {
      console.log('   Detalles:', detalles);
    }
    
    const response = await fetch(config.GOOGLE_SHEET_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: nombre || 'Desconocido',
        telefono: telefono || 'Sin número',
        tipo_solicitud: tipoSolicitud || 'Consulta general',
        detalles: detalles || '' // Nuevo campo para detalles de cita
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Datos guardados en Google Sheets');
    } else {
      console.log('❌ Error al guardar:', data.error);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error en petición a Sheets:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Leer datos desde Google Sheets
 * @returns {Promise<Object>} Datos del sheet
 */
export async function leerGoogleSheet() {
  if (!config.GOOGLE_SHEET_API) {
    return { success: false, error: 'API no configurada' };
  }
  
  try {
    const response = await fetch(config.GOOGLE_SHEET_API, {
      method: 'GET'
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Error al leer Sheets:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Genera HTML con tabla de registros
 * @returns {Promise<string>} HTML de la tabla
 */
export async function generarTablaHTML() {
  const datos = await leerGoogleSheet();
  
  if (!datos.success) {
    return `
      <h2>❌ Error al obtener datos</h2>
      <p>${datos.error}</p>
      <p><a href="/">← Volver</a></p>
    `;
  }
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Registros WhatsApp</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #25D366; }
        .stats { background: #e7f7ef; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #25D366; color: white; position: sticky; top: 0; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        tr:hover { background-color: #e7f7ef; }
        .cita { background-color: #fff3cd; font-weight: bold; }
        .back-link { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #25D366; color: white; text-decoration: none; border-radius: 5px; }
        .back-link:hover { background: #1fa855; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📊 Registros de WhatsApp Bot</h1>
        <div class="stats">
          <p>📈 Total de registros: <strong>${datos.total || 0}</strong></p>
          <p>🤖 Bot: ${config.BOT_CONFIG.vendedor} - ${config.BOT_CONFIG.empresa}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Tipo de Solicitud</th>
              <th>Detalles</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
  `;
  
  let index = 1;
  for (const item of datos.data || []) {
    const esCita = item.tipo_solicitud?.includes('Cita') || item.tipo_solicitud?.includes('🗓️');
    const rowClass = esCita ? 'cita' : '';
    
    html += `
      <tr class="${rowClass}">
        <td>${index++}</td>
        <td>${item.nombre || 'N/A'}</td>
        <td>${item.telefono || 'N/A'}</td>
        <td>${item.tipo_solicitud || 'N/A'}</td>
        <td>${item.detalles || '-'}</td>
        <td>${item.fecha || 'N/A'}</td>
      </tr>
    `;
  }
  
  html += `
          </tbody>
        </table>
        <a href="/" class="back-link">← Volver al inicio</a>
      </div>
    </body>
    </html>
  `;
  
  return html;
}
