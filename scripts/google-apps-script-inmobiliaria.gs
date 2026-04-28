// ========================================
// API REST — WhatsApp Bot Inmobiliario
// Hoja: columna A=Ciudad, B=Direccion, C=Precio, D+=Fotos (URLs)
//
// CITAS — Fila 1 recomendada (debe coincidir con appendRow):
//   Fecha | Hora | Nombre | Teléfono | Tipo solicitud | Detalles
// ========================================

const SHEET_CITAS = "citas";
const SHEET_ARRIENDO = "propiedades_arriendo";
const SHEET_VENTA = "propiedades_venta";

/**
 * Convierte precio de la celda a número COP.
 * Evita el bug de parseFloat("2.900.000") === 2.9 en JavaScript.
 */
function parseCOPNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && !isNaN(value)) return value;

  var s = String(value)
    .trim()
    .replace(/[$\s\u00a0]/g, "");
  if (!s) return 0;

  if (/^\d+$/.test(s)) return parseFloat(s);

  // Decimal con coma final: 1.234,56
  if (/,/.test(s) && /\d,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
    var n1 = parseFloat(s);
    return isNaN(n1) ? 0 : n1;
  }

  // Puntos como miles (Colombia / Excel): 850.000.000 / 2.900.000
  s = s.replace(/\./g, "");
  var n2 = parseFloat(s);
  return isNaN(n2) ? 0 : n2;
}

/** Primera URL http(s) desde la columna D en adelante (arriendo puede tener varias fotos). */
function firstPhotoUrl(row, startIndex) {
  var from = startIndex !== undefined ? startIndex : 3;
  var i;
  for (i = from; i < row.length; i++) {
    var cell = row[i];
    if (cell === null || cell === undefined || cell === "") continue;
    var t = String(cell).trim();
    if (/^https?:\/\//i.test(t)) return t;
  }
  return "";
}

function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = String(params.action || "");

    if (action === "getArriendo") {
      return getProperties(SHEET_ARRIENDO, params, "rent");
    }

    if (action === "getVenta") {
      return getProperties(SHEET_VENTA, params, "sale");
    }

    if (action === "getInventario") {
      return getInventario(params);
    }

    if (action === "getCitas") {
      return getAppointments();
    }

    return createJsonResponse({
      success: false,
      error:
        "Invalid action. Use: getArriendo, getVenta, getInventario, getCitas",
    });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function getInventario(params) {
  const rent = getPropertiesArray(SHEET_ARRIENDO, params) || [];
  const sale = getPropertiesArray(SHEET_VENTA, params) || [];
  const merged = rent
    .map(function (p) {
      return Object.assign({}, p, { listingType: "rent" });
    })
    .concat(
      sale.map(function (p) {
        return Object.assign({}, p, { listingType: "sale" });
      })
    );

  return createJsonResponse({
    success: true,
    total: merged.length,
    propiedades: merged,
  });
}

function getProperties(sheetName, params, listingType) {
  const properties = getPropertiesArray(sheetName, params);
  if (properties === null) {
    return createJsonResponse({ success: false, error: "Sheet not found" });
  }

  var tagged = properties.map(function (p) {
    return Object.assign({}, p, { listingType: listingType });
  });

  return createJsonResponse({
    success: true,
    total: tagged.length,
    type: listingType,
    propiedades: tagged,
  });
}

function getPropertiesArray(sheetName, params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  var properties = rows
    .map(function (row) {
      var precioNum = parseCOPNumber(row[2]);
      var photo = firstPhotoUrl(row, 3);
      return {
        city: row[0] || "",
        address: row[1] || "",
        price: precioNum,
        photo: photo,
        ciudad: row[0] || "",
        direccion: row[1] || "",
        precio: precioNum,
        foto: photo,
      };
    })
    .filter(function (p) {
      return String(p.city || "").trim() !== "";
    });

  var citySearch = norm(params.city || params.ciudad || "");
  if (citySearch) {
    properties = properties.filter(function (p) {
      return norm(p.city).indexOf(citySearch) !== -1;
    });
  }

  var maxPrice = parseCOPNumber(
    params.price || params.precioMax || params.precio || 0
  );
  if (maxPrice > 0) {
    properties = properties.filter(function (p) {
      return p.price <= maxPrice;
    });
  }

  var q = norm(params.q || params.busqueda || params.query || "");
  if (q) {
    properties = properties.filter(function (p) {
      return (
        norm(p.city).indexOf(q) !== -1 ||
        norm(p.address).indexOf(q) !== -1 ||
        String(p.price).indexOf(q) !== -1
      );
    });
  }

  var category = norm(params.category || params.categoria || "");
  if (category) {
    properties = properties.filter(function (p) {
      return (
        norm(p.address).indexOf(category) !== -1 ||
        norm(p.city).indexOf(category) !== -1
      );
    });
  }

  return properties;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getAppointments() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CITAS);
  if (!sheet) {
    return createJsonResponse({ success: false, error: "Citas sheet not found" });
  }

  const data = sheet.getDataRange().getValues();
  const appointments = data.slice(1).map(function (row) {
    return {
      date: row[0],
      time: row[1],
      name: row[2],
      phone: row[3],
      requestType: row[4],
      details: row[5],
      fecha: [row[0], row[1]].filter(Boolean).join(" "),
      nombre: row[2],
      telefono: row[3],
      tipo_solicitud: row[4],
      detalles: row[5],
    };
  }).filter(function (a) {
    return String(a.name || "").trim() !== "";
  });

  return createJsonResponse({
    success: true,
    total: appointments.length,
    citas: appointments,
  });
}

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CITAS);
    if (!sheet) {
      return createJsonResponse({ success: false, error: "Sheet not found" });
    }

    const raw = e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const now = new Date();

    var name = data.name || data.nombre || "Unknown";
    var phone = data.phone || data.telefono || "No number";
    var requestType =
      data.requestType || data.tipo_solicitud || "General Inquiry";
    var details = data.details || data.detalles || "";

    // Orden: Fecha, Hora, Nombre, Teléfono, Tipo, Detalles (ajusta encabezados de fila 1 en la hoja)
    var rowData = [
      Utilities.formatDate(now, "GMT-5", "dd/MM/yyyy"),
      Utilities.formatDate(now, "GMT-5", "HH:mm:ss"),
      name,
      phone,
      requestType,
      details,
    ];

    sheet.appendRow(rowData);
    return createJsonResponse({ success: true, message: "Saved successfully" });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
