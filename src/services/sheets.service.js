// src/services/sheets.service.js

import { config } from "../config/config.js";

/**
 * El bot envía parámetros en inglés (q, category, sku).
 * Algunos Apps Script esperan español (busqueda, categoria, codigo).
 * Duplicamos claves para que el script reciba ambos nombres.
 */
function expandSheetQueryParams(params) {
  const out = { ...params };

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

export async function addStock(item, qty, price, isNew = false) {
    return saveToSheet({ item, qty, price, new: isNew }, "addStock");
}

export async function recordSale(item, qty) {
    return saveToSheet({ item, qty }, "sellInventory");
}

/**
 * GET ?action=getInventario&q=&sku=&category=...
 * Respuesta esperada: JSON { success: true, items: [ {...}, ... ] } (u otras claves, ver getRowsFromSheetResponse).
 */
export async function fetchFromSheet(action = "getInventario", params = {}) {
  if (!config.sheetsConfig.apiUrl) {
    return { success: false, error: "API not configured" };
  }

  try {
    const base = config.sheetsConfig.apiUrl.replace(/\/$/, "");
    const usp = buildSearchParams(action, { ...params });
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
