// src/services/sheets.service.js

import { config } from "../config/config.js";

/**
 * Convierte presupuesto a pesos COP para el filtro de la hoja.
 * - "10" o 10 desde la IA → 10_000_000 (diez millones).
 * - "10 millones", "15millones" en texto.
 * - Valores ≥ 1_000_000 se dejan como están (ya son COP completos).
 */
export function normalizeBudgetForSheets(params) {
  const out = { ...params };
  const keys = ["price", "precioMax", "precio"];

  for (const k of keys) {
    if (out[k] == null || out[k] === "") continue;
    let raw = String(out[k]).trim().replace(/\s+/g, " ");

    const millonesText = raw.match(
      /^(\d+([.,]\d+)?)\s*m(il[l]?ones?)?$/i
    );
    if (millonesText) {
      const n = parseFloat(millonesText[1].replace(",", "."));
      if (!isNaN(n) && n > 0) {
        out[k] = String(Math.round(n * 1_000_000));
      }
      continue;
    }

    raw = raw.replace(/\s/g, "");
    let n = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    if (isNaN(n) || n <= 0) continue;

    if (n >= 1 && n < 1_000_000 && Number.isInteger(n)) {
      n = n * 1_000_000;
    }
    out[k] = String(Math.round(n));
  }

  return out;
}

/**
 * Huella estable para no repetir la misma consulta al cliente.
 */
export function buildSheetQueryKey(action, query) {
  const q = normalizeBudgetForSheets({ ...query });
  delete q.type;
  const sortedKeys = Object.keys(q).sort();
  const norm = {};
  for (const key of sortedKeys) {
    if (q[key] == null || q[key] === "") continue;
    norm[key] = String(q[key]).trim();
  }
  return `${action}|${JSON.stringify(norm)}`;
}

/**
 * El bot envía parámetros en inglés (city, price, q, category, sku).
 * Muchos Apps Script antiguos esperan español (ciudad, precioMax, busqueda).
 * Duplicamos claves para que el script reciba ambos nombres.
 */
function expandSheetQueryParams(params) {
  const out = { ...params };
  if (out.city && !out.ciudad) out.ciudad = out.city;
  if (out.ciudad && !out.city) out.city = out.ciudad;

  const priceVal =
    out.price != null && out.price !== ""
      ? String(out.price)
      : out.precioMax != null && out.precioMax !== ""
        ? String(out.precioMax)
        : out.precio != null && out.precio !== ""
          ? String(out.precio)
          : null;
  if (priceVal) {
    if (!out.price) out.price = priceVal;
    if (!out.precioMax) out.precioMax = priceVal;
    if (!out.precio) out.precio = priceVal;
  }

  if (out.q && !out.busqueda) out.busqueda = out.q;
  if (out.busqueda && !out.q) out.q = out.busqueda;

  if (out.category && !out.categoria) out.categoria = out.category;
  if (out.categoria && !out.category) out.category = out.categoria;

  if (out.sku && !out.codigo) out.codigo = out.sku;
  if (out.codigo && !out.sku) out.sku = out.codigo;

  return out;
}

function buildSearchParams(action, params) {
  const merged = expandSheetQueryParams(params);
  const usp = new URLSearchParams();
  usp.set("action", String(action));
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === "") continue;
    usp.set(k, s);
  }
  return usp;
}

async function parseResponseAsJson(response) {
  const text = await response.text();
  const ct = response.headers.get("content-type") || "";

  if (!response.ok) {
    console.error(
      "❌ Sheets HTTP",
      response.status,
      text.slice(0, 500)
    );
    return {
      success: false,
      error: `HTTP ${response.status}`,
      _hint: "Revisa despliegue del Web App y permisos en Apps Script.",
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error(
      "❌ Sheets: la respuesta no es JSON. Content-Type:",
      ct,
      text.slice(0, 600)
    );
    return {
      success: false,
      error:
        "La URL no devolvió JSON. ¿Apps Script publicado como aplicación web con acceso adecuado?",
    };
  }
}

/**
 * Lista de filas que el bot puede mostrar (cualquiera de estas claves en el JSON).
 */
export function getRowsFromSheetResponse(data) {
  if (!data || typeof data !== "object") return [];
  const keys = [
    "propiedades",
    "items",
    "inventario",
    "productos",
    "data",
    "rows",
    "resultados",
  ];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/**
 * Saves contact, appointment, or inventory data to Google Sheets
 */
export async function saveToSheet(data, action = "saveCita") {
  if (!config.sheetsConfig.apiUrl) {
    console.error("⚠️ SHEETS_API_URL not configured");
    return { success: false, error: "API not configured" };
  }

  try {
    const payload = {
        action,
        ...data
    };
    
    console.log(`📊 Sheets POST ${action}:`, data);

    const response = await fetch(config.sheetsConfig.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await parseResponseAsJson(response);
    if (result.success) {
      console.log(`✅ Sheets ${action}: OK`);
    } else {
      console.log(`❌ Sheets ${action}:`, result.error || result);
    }
    return result;
  } catch (error) {
    console.error(`❌ Sheets Service Error (POST ${action}):`, error.message);
    return { success: false, error: error.message };
  }
}

export async function addStock(item, qty, price) {
    return saveToSheet({ item, qty, price }, "addStock");
}

export async function recordSale(item, qty) {
    return saveToSheet({ item, qty }, "sellInventory");
}

/**
 * GET ?action=getVenta|getArriendo|getInventario|getCitas&city=&ciudad=&price=&precioMax=...
 * Respuesta esperada: JSON { success: true, propiedades: [ {...}, ... ] } (u otras claves ver getRowsFromSheetResponse).
 */
export async function fetchFromSheet(action = "getInventario", params = {}) {
  if (!config.sheetsConfig.apiUrl) {
    return { success: false, error: "API not configured" };
  }

  try {
    const paramsN = normalizeBudgetForSheets({ ...params });
    const base = config.sheetsConfig.apiUrl.replace(/\/$/, "");
    const usp = buildSearchParams(action, paramsN);
    const qs = usp.toString();
    const url = `${base}?${qs}`;

    const u = new URL(base);
    console.log("📊 Sheets GET:", u.pathname, "?", qs);

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const data = await parseResponseAsJson(response);
    const rows = getRowsFromSheetResponse(data);
    console.log(
      `📊 Sheets respuesta: success=${data.success}, filas=${rows.length}`
    );
    return data;
  } catch (error) {
    console.error("❌ Sheets Service Error (GET):", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generates an HTML dashboard to view the records
 */
export async function generateRecordsHtml() {
  const response = await fetchFromSheet("getCitas");

  if (!response.success) {
    return `<h2>❌ Error fetching data</h2><p>${response.error}</p>`;
  }

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
    const isAppointment = item.tipo_solicitud?.includes("Cita");
    html += `
      <tr class="${isAppointment ? "appointment-row" : ""}">
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
