// ========================================
// API REST — WhatsApp Bot Inventario Indias Motos
// Hoja: inventario (A=SKU/ID, B=Nombre, C=Precio, D=Cantidad, E=Foto)
// Hoja: ventas (A=Fecha, B=Item, C=Cantidad, D=Precio Unitario, E=Total)
// ========================================

const SHEET_INVENTARIO = "inventario";
const SHEET_VENTAS = "ventas";

function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = String(params.action || "");

    if (action === "getInventario") {
      return getInventario(params);
    }

    return createJsonResponse({
      success: false,
      error: "Invalid action. Use: getInventario",
    });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function getInventario(params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTARIO);
  if (!sheet) return createJsonResponse({ success: false, error: "Sheet inventario not found" });

  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  var items = rows.map(function (row) {
    return {
      sku: row[0],
      nombre: row[1],
      precio: row[2],
      stock: row[3],
      foto: row[4]
    };
  }).filter(function (p) {
    return String(p.nombre || "").trim() !== "";
  });

  var q = norm(params.q || params.busqueda || params.query || "");
  if (q && q !== "todos") {
    items = items.filter(function (p) {
      return norm(p.nombre).indexOf(q) !== -1 || norm(p.sku).indexOf(q) !== -1;
    });
  }

  return createJsonResponse({
    success: true,
    total: items.length,
    inventario: items,
  });
}

function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const action = data.action;

    if (action === "addStock") {
      return addStock(data);
    } else if (action === "sellInventory") {
      return sellInventory(data);
    }

    return createJsonResponse({ success: false, error: "Invalid POST action" });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function addStock(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTARIO);
  const rows = sheet.getDataRange().getValues();
  const itemName = String(data.item).toLowerCase();
  const qtyToAdd = parseInt(data.qty) || 0;
  const price = data.price || 0;

  let found = false;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === itemName) {
      const currentStock = parseInt(rows[i][3]) || 0;
      sheet.getRange(i + 1, 4).setValue(currentStock + qtyToAdd);
      if (price) sheet.getRange(i + 1, 3).setValue(price);
      found = true;
      break;
    }
  }

  if (!found) {
    sheet.appendRow(["", data.item, price, qtyToAdd, ""]);
  }

  return createJsonResponse({ success: true, message: "Stock updated" });
}

function sellInventory(data) {
  const invSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTARIO);
  const salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VENTAS);
  const rows = invSheet.getDataRange().getValues();
  const itemName = String(data.item).toLowerCase();
  const qtyToSell = parseInt(data.qty) || 0;

  let found = false;
  let unitPrice = 0;
  let finalItemName = data.item;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === itemName) {
      const currentStock = parseInt(rows[i][3]) || 0;
      if (currentStock < qtyToSell) {
        return createJsonResponse({ success: false, error: "Stock insuficiente. Disponible: " + currentStock });
      }
      invSheet.getRange(i + 1, 4).setValue(currentStock - qtyToSell);
      unitPrice = rows[i][2];
      finalItemName = rows[i][1];
      found = true;
      break;
    }
  }

  if (!found) {
    return createJsonResponse({ success: false, error: "Producto no encontrado en inventario" });
  }

  // Registrar en ventas
  const now = new Date();
  const total = unitPrice * qtyToSell;
  salesSheet.appendRow([
    Utilities.formatDate(now, "GMT-5", "dd/MM/yyyy HH:mm:ss"),
    finalItemName,
    qtyToSell,
    unitPrice,
    total
  ]);

  return createJsonResponse({ success: true, message: "Sale recorded and stock updated" });
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
