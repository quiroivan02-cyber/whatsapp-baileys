// src/services/sheets.service.js

import { config } from '../config/config.js';

/**
 * Saves contact or appointment data to Google Sheets
 * @param {Object} data - Object containing name, phone, requestType and details
 * @returns {Promise<Object>} Operation result
 */
export async function saveToSheet(data) {
  const { name, phone, requestType, details = '' } = data;

  if (!config.sheetsConfig.apiUrl) {
    console.error('⚠️ SHEETS_API_URL not configured');
    return { success: false, error: 'API not configured' };
  }
  
  try {
    console.log('📊 Saving to Google Sheets...');
    
    const response = await fetch(config.sheetsConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Mapping our English variables to your Google Script expected keys
      body: JSON.stringify({
        nombre: name || 'Unknown',
        telefono: phone || 'No number',
        tipo_solicitud: requestType || 'General Inquiry',
        detalles: details
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Data successfully saved to Google Sheets');
    } else {
      console.log('❌ Error saving data:', result.error);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Sheets Service Error (POST):', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Fetches properties or records from Google Sheets
 * @param {string} action - Action to perform (getArriendo, getVenta, etc)
 * @param {Object} params - Additional query parameters (city, maxPrice)
 * @returns {Promise<Object>} Data from sheet
 */
export async function fetchFromSheet(action = 'getArriendo', params = {}) {
  if (!config.sheetsConfig.apiUrl) {
    return { success: false, error: 'API not configured' };
  }
  
  try {
    const queryParams = new URLSearchParams({ action, ...params }).toString();
    const response = await fetch(`${config.sheetsConfig.apiUrl}?${queryParams}`, {
      method: 'GET'
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Sheets Service Error (GET):', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generates an HTML dashboard to view the records
 * @returns {Promise<string>} HTML Table
 */
export async function generateRecordsHtml() {
  const response = await fetchFromSheet('getCitas');
  
  if (!response.success) {
    return `<h2>❌ Error fetching data</h2><p>${response.error}</p>`;
  }
  
  // Note: Keeping the UI titles in Spanish for the final user, 
  // but variable logic in English.
  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #f0f2f5; }
        .table-container { background: white; padding: 20px; border-radius: 8px; shadow: 0 4px 6px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background-color: #25D366; color: white; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #ddd; }
        .appointment-row { background-color: #fff9e6; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="table-container">
        <h1>📊 Real Estate Bot Records</h1>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Type</th>
              <th>Details</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
  `;
  
  for (const item of response.citas || []) {
    const isAppointment = item.tipo_solicitud?.includes('Cita');
    html += `
      <tr class="${isAppointment ? 'appointment-row' : ''}">
        <td>${item.nombre}</td>
        <td>${item.telefono}</td>
        <td>${item.tipo_solicitud}</td>
        <td>${item.detalles}</td>
        <td>${item.fecha}</td>
      </tr>`;
  }
  
  html += `</tbody></table></div></body></html>`;
  return html;
}