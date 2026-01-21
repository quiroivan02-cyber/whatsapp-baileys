// ========================================
// INTEGRACIÓN CON GOOGLE SHEETS
// ========================================

import { config } from './config.js';

/**
 * Guarda datos en Google Sheets
 * @param {string} nombre - Nombre del contacto
 * @param {string} telefono - Número de teléfono
 * @param {string} tipoSolicitud - Tipo de solicitud
 * @returns {Promise<Object>} Resultado de la operación
 */
export async function guardarEnGoogleSheet(nombre, telefono, tipoSolicitud) {
  if (!config.GOOGLE_SHEET_API) {
    console.log('⚠️ GOOGLE_SHEET_API no configurada');
    return { success: false, error: 'API no configurada' };
  }
  
  try {
    console.log('📊 Guardando en Google Sheets...');
    console.log('   Nombre:', nombre);
    console.log('   Teléfono:', telefono);
    console.log('   Tipo:', tipoSolicitud);
    
    const response = await fetch(config.GOOGLE_SHEET_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: nombre || 'Desconocido',
        telefono: telefono || 'Sin número',
        tipo_solicitud: tipoSolicitud || 'Consulta general'
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
        body { font-family: Arial, sans-serif; padding: 20px; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #25D366; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
      </style>
    </head>
    <body>
      <h1>📊 Registros de WhatsApp</h1>
      <p>Total de mensajes: <strong>${datos.total || 0}</strong></p>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>Tipo de Solicitud</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  for (const item of datos.data || []) {
    html += `
      <tr>
        <td>${item.nombre}</td>
        <td>${item.telefono}</td>
        <td>${item.tipo_solicitud}</td>
        <td>${item.fecha || 'N/A'}</td>
      </tr>
    `;
  }
  
  html += `
        </tbody>
      </table>
      <br>
      <p><a href="/">← Volver al inicio</a></p>
    </body>
    </html>
  `;
  
  return html;
}
