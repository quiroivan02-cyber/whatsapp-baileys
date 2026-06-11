// ========================================
// API REST — WhatsApp Bot Inventario Indias Motos
// Hojas requeridas: Inventario, Ventas, Contabilidad
//
// ESTRUCTURA DE COLUMNAS (¡importante respetarla!):
//   Inventario:   A=ID | B=Nombre Producto | C=Cantidad | D=Costo Und | E=Precio Venta | F=Subtotal(opcional)
//   Ventas:       A=ID Venta | B=ID Producto | C=Producto | D=Cantidad | E=Precio Venta Und | F=Costo Und | G=Total Venta | H=Ganancia | I=Fecha/Hora
//   Contabilidad: A=Fecha/Hora | B=Descripción | C=Monto | D=Tipo | E=Ganancia
//
// NOTA: las pestañas Ventas y Contabilidad DEBEN tener su fila 1 de encabezados,
// si no, el ID de venta se repite (la numeración arranca a partir de la fila 2).
// ========================================

const SHEET_INVENTARIO = "Inventario";
const SHEET_VENTAS = "Ventas";
const SHEET_CONTABILIDAD = "Contabilidad";

/**
 * Convierte el valor de una celda (texto o número) a número.
 */
function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  var s = String(value).replace(/[$.]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

/**
 * Formatea un número como moneda colombiana ($1.234.567), sin depender del locale.
 */
function fmt(n) {
  var num = Math.round(Number(n) || 0);
  return "$" + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // Quitar acentos (escape ASCII, seguro para copiar/pegar)
    .replace(/[^a-z0-9]/g, "")       // Quitar todo lo que no sea letra o número (especialmente guiones y espacios)
    .trim();
}

/**
 * ¿Aparecen TODAS las palabras de la búsqueda dentro del nombre normalizado?
 * Tolera orden distinto y palabras intercaladas (ej: "aceite 20w50" => "Aceite motor 20W-50 1L").
 */
function matchesQuery(productNorm, queryRaw) {
  var tokens = String(queryRaw || "").split(/\s+/)
    .map(function(t) { return norm(t); })
    .filter(function(t) { return t.length > 0; });
  if (tokens.length === 0) return false;
  return tokens.every(function(t) {
    if (productNorm.indexOf(t) !== -1) return true;
    // Tolera plural simple: "llantas" => "llanta", "aceites" => "aceite".
    if (t.length > 3 && t.charAt(t.length - 1) === "s" && productNorm.indexOf(t.slice(0, -1)) !== -1) return true;
    return false;
  });
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

  // 3. Intento por palabras (todas las palabras de la búsqueda están en el nombre)
  for (let i = 1; i < rows.length; i++) {
    if (matchesQuery(norm(rows[i][1]), itemName)) return i + 1;
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

    if (action === "getReporte") {
      return getReporte(params);
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
      sku: row[0],                  // Col A: ID
      nombre: row[1],               // Col B: Nombre Producto
      stock: parseInt(row[2]) || 0, // Col C: Cantidad
      costo: parseNumber(row[3]),   // Col D: Costo Und
      precio: parseNumber(row[4]),  // Col E: Precio Venta (lo que ve/paga el cliente)
    };
  }).filter(function(item) {
    return item.nombre !== "";
  });

  // Filtro de búsqueda (por palabras: tolera orden distinto y palabras intercaladas)
  var qRaw = params.q || params.busqueda || "";
  var qNorm = norm(qRaw);
  if (qNorm && qNorm !== "todos") {
    items = items.filter(function(item) {
      return matchesQuery(norm(item.nombre), qRaw) || norm(item.sku).indexOf(qNorm) !== -1;
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
  const cost = data.price ? parseNumber(data.price) : null; // En "ingresar inventario", el precio = costo

  // Si el bot indica que es NUEVO, no buscamos coincidencia (evita fusiones por nombre parecido).
  const foundIndex = data.new ? -1 : findProductRow(rows, data.item);

  let message;
  let nombreFinal = data.item;
  if (foundIndex !== -1) {
    nombreFinal = rows[foundIndex - 1][1];
    const currentStock = parseInt(rows[foundIndex - 1][2]) || 0;
    sheet.getRange(foundIndex, 3).setValue(currentStock + qty); // C: Cantidad
    if (cost) sheet.getRange(foundIndex, 4).setValue(cost);     // D: Costo Und
    message = "Stock actualizado";
  } else {
    // Crear nuevo. Precio Venta arranca igual al costo (ajustable luego en la hoja).
    sheet.appendRow([rows.length, data.item, qty, cost || 0, cost || 0]);
    message = "Nuevo producto creado";
  }

  // Registrar el EGRESO (gasto por compra de inventario) en Contabilidad.
  const contSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONTABILIDAD);
  if (contSheet && cost) {
    const totalGasto = cost * qty;
    const timestamp = Utilities.formatDate(new Date(), "GMT-5", "dd/MM/yyyy HH:mm:ss");
    contSheet.appendRow([timestamp, "COMPRA: " + nombreFinal + " x" + qty, totalGasto, "EGRESO", ""]);
  }

  return createJsonResponse({ success: true, message: message });
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

  const productId = rows[foundIndex - 1][0];
  const finalName = rows[foundIndex - 1][1];
  const costoUnd = parseNumber(rows[foundIndex - 1][3]);    // Col D: Costo Und
  let precioVenta = parseNumber(rows[foundIndex - 1][4]);   // Col E: Precio Venta
  if (!precioVenta) precioVenta = costoUnd;                 // Fallback: si no se cargó precio de venta, usa el costo

  const currentStock = parseInt(rows[foundIndex - 1][2]) || 0;
  if (currentStock < qty) {
    return createJsonResponse({ success: false, error: "Stock insuficiente para " + finalName + ". Disponible: " + currentStock });
  }

  const totalVenta = precioVenta * qty;
  const totalCosto = costoUnd * qty;
  const ganancia = totalVenta - totalCosto;
  const stockFinal = currentStock - qty;

  // 1. Actualizar Stock
  invSheet.getRange(foundIndex, 3).setValue(stockFinal);

  // 2. Preparar timestamp e ID de venta secuencial
  const now = new Date();
  const timestamp = Utilities.formatDate(now, "GMT-5", "dd/MM/yyyy HH:mm:ss");

  let idVenta = 1;
  if (salesSheet) {
    const lastRow = salesSheet.getLastRow();
    if (lastRow > 1) {
      const lastId = salesSheet.getRange(lastRow, 1).getValue();
      if (!isNaN(lastId)) idVenta = parseInt(lastId) + 1;
    }
  }

  // 3. Registrar en VENTAS (con margen)
  if (salesSheet) {
    salesSheet.appendRow([idVenta, productId, finalName, qty, precioVenta, costoUnd, totalVenta, ganancia, timestamp]);
  }

  // 4. Registrar en CONTABILIDAD (ingreso real + ganancia)
  if (contSheet) {
    contSheet.appendRow([timestamp, "VENTA: " + finalName + " (ID: " + idVenta + ")", totalVenta, "INGRESO", ganancia]);
  }

  return createJsonResponse({
    success: true,
    message: "Venta #" + idVenta + ": " + qty + "x " + finalName + " = " + fmt(totalVenta) + " (ganancia " + fmt(ganancia) + "). Stock restante: " + stockFinal + ".",
    idVenta: idVenta,
    total: totalVenta,
    ganancia: ganancia,
    stock: stockFinal
  });
}

// --- INFORME CONTABLE (lectura por período) ---
function getReporte(params) {
  const contSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONTABILIDAD);
  if (!contSheet) return createJsonResponse({ success: false, error: "Hoja Contabilidad no encontrada" });

  const data = contSheet.getDataRange().getValues();
  const rows = data.slice(1); // omitir encabezado
  const range = getPeriodRange(String(params.period || "mes"));

  var ingresos = 0, egresos = 0, ganancia = 0, ventas = 0;
  rows.forEach(function(r) {
    var fecha = parseSheetDate(r[0]);                // Col A: Fecha/Hora
    if (!fecha || fecha < range.start || fecha > range.end) return;
    var tipo = String(r[3] || "").toUpperCase();     // Col D: Tipo
    var monto = parseNumber(r[2]);                    // Col C: Monto
    if (tipo === "INGRESO") {
      ingresos += monto;
      ventas += 1;
      ganancia += parseNumber(r[4]);                 // Col E: Ganancia
    } else if (tipo === "EGRESO") {
      egresos += monto;
    }
  });

  return createJsonResponse({
    success: true,
    period: range.label,
    ingresos: ingresos,
    egresos: egresos,
    ganancia: ganancia,
    ventas: ventas,
    neto: ingresos - egresos
  });
}

/** Convierte "dd/MM/yyyy HH:mm:ss" (o un Date) a Date. */
function parseSheetDate(value) {
  if (value instanceof Date) return value;
  var m = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
}

/** Rango de fechas: "quincena" (1-15 o 16-fin según hoy) o "mes" (mes actual completo). */
function getPeriodRange(period) {
  var now = new Date();
  var y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  if (period === "quincena") {
    if (d <= 15) {
      return { start: new Date(y, mo, 1), end: new Date(y, mo, 15, 23, 59, 59), label: "quincena (1 al 15)" };
    }
    return { start: new Date(y, mo, 16), end: new Date(y, mo + 1, 0, 23, 59, 59), label: "quincena (16 a fin de mes)" };
  }
  return { start: new Date(y, mo, 1), end: new Date(y, mo + 1, 0, 23, 59, 59), label: "este mes" };
}
