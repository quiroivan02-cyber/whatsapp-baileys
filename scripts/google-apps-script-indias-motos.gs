// ========================================
// API REST — WhatsApp Bot Inventario Indias Motos
// Hojas requeridas: Inventario, Ventas, Contabilidad
// ========================================

const SHEET_INVENTARIO = "Inventario";
const SHEET_VENTAS = "Ventas";
const SHEET_CONTABILIDAD = "Contabilidad";

/**
 * Convierte precio de la celda a número.
 */
function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  var s = String(value).replace(/[$.]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/[^a-z0-9]/g, "")       // Quitar todo lo que no sea letra o número (especialmente guiones y espacios)
    .trim();
}

/**
 * Busca un producto por nombre usando coincidencia estricta y luego flexible.
 */
function findProductRow(rows, itemName) {
  const normalizedSearch = norm(itemName);
  if (!normalizedSearch) return -1;

  // 1. Intento de coincidencia exacta (normalizada)
  for (let i = 1; i < rows.length; i++) {
    if (norm(rows[i][1]) === normalizedSearch) return i + 1;
  }

  // 2. Intento de coincidencia parcial (si el nombre en la hoja contiene la búsqueda)
  for (let i = 1; i < rows.length; i++) {
    if (norm(rows[i][1]).indexOf(normalizedSearch) !== -1) return i + 1;
  }

  return -1;
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// --- MANEJO DE PETICIONES GET (CONSULTAS) ---
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = String(params.action || "");

    if (action === "getInventario") {
      return getInventario(params);
    }

    return createJsonResponse({ success: false, error: "Acción no válida" });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function getInventario(params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTARIO);
  if (!sheet) return createJsonResponse({ success: false, error: "Hoja Inventario no encontrada" });

  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1); // Omitir encabezado

  var items = rows.map(function(row) {
    return {
      sku: row[0],         // Col A: ID
      nombre: row[1],      // Col B: Nombre Producto
      stock: parseInt(row[2]) || 0, // Col C: Cantidad
      precio: parseNumber(row[3]),  // Col D: Costo Und
    };
  }).filter(function(item) {
    return item.nombre !== "";
  });

  // Filtro de búsqueda
  var q = norm(params.q || params.busqueda || "");
  if (q && q !== "todos") {
    items = items.filter(function(item) {
      return norm(item.nombre).indexOf(q) !== -1 || norm(item.sku).indexOf(q) !== -1;
    });
  }

  return createJsonResponse({
    success: true,
    total: items.length,
    inventario: items
  });
}

// --- MANEJO DE PETICIONES POST (ACCIONES) ---
function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const action = data.action;

    if (action === "addStock") return addStock(data);
    if (action === "sellInventory") return sellInventory(data);

    return createJsonResponse({ success: false, error: "Acción POST no reconocida" });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function addStock(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTARIO);
  const rows = sheet.getDataRange().getValues();
  const qty = parseInt(data.qty) || 0;
  const price = data.price || null;

  const foundIndex = findProductRow(rows, data.item);

  if (foundIndex !== -1) {
    const currentStock = parseInt(rows[foundIndex - 1][2]) || 0;
    sheet.getRange(foundIndex, 3).setValue(currentStock + qty);
    if (price) sheet.getRange(foundIndex, 4).setValue(price);
    return createJsonResponse({ success: true, message: "Stock actualizado" });
  }

  // Si no existe, crear nuevo
  sheet.appendRow([rows.length, data.item, qty, price || 0]);
  return createJsonResponse({ success: true, message: "Nuevo producto creado" });
}

function sellInventory(data) {
  const invSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTARIO);
  const salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VENTAS);
  const contSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONTABILIDAD);
  
  const rows = invSheet.getDataRange().getValues();
  const qty = parseInt(data.qty) || 0;

  const foundIndex = findProductRow(rows, data.item);

  if (foundIndex === -1) {
    return createJsonResponse({ success: false, error: "Producto '" + data.item + "' no encontrado. Intenta con un nombre más claro (ej: Aceite)." });
  }

  const productId = rows[foundIndex-1][0];
  const unitPrice = parseNumber(rows[foundIndex-1][3]);
  const finalName = rows[foundIndex-1][1];

  const currentStock = parseInt(rows[foundIndex-1][2]) || 0;
  if (currentStock < qty) {
    return createJsonResponse({ success: false, error: "Stock insuficiente para " + finalName + ". Disponible: " + currentStock });
  }

  // 1. Actualizar Stock
  invSheet.getRange(foundIndex, 3).setValue(currentStock - qty);

  // 2. Registrar en VENTAS
  const now = new Date();
  const totalVenta = unitPrice * qty;
  const timestamp = Utilities.formatDate(now, "GMT-5", "dd/MM/yyyy HH:mm:ss");
  
  // Generar ID secuencial
  let idVenta = 1;
  const lastRow = salesSheet.getLastRow();
  if (lastRow > 1) {
    const lastId = salesSheet.getRange(lastRow, 1).getValue();
    if (!isNaN(lastId)) {
      idVenta = parseInt(lastId) + 1;
    }
  }

  // Nueva estructura de Ventas: id_venta, id_producto, cantidad, precio_Venta, fecha_hora
  if (salesSheet) {
    salesSheet.appendRow([idVenta, productId, qty, unitPrice, timestamp]);
  }

  // 3. Registrar en CONTABILIDAD (Ingreso por venta)
  if (contSheet) {
    contSheet.appendRow([timestamp, "VENTA: " + finalName + " (ID: " + idVenta + ")", totalVenta, "INGRESO"]);
  }

  return createJsonResponse({ success: true, message: "Venta registrada (" + idVenta + "), stock actualizado." });
}
