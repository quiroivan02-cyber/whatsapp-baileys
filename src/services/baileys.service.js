import makeWASocket, {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { usePostgresAuthState, clearPostgresAuthState } from "./auth.service.js";
import {
    appendTurn,
    getHistoryForJid,
    getStateForJid,
    setStateForJid,
    setTempBufferForJid,
    getTempBufferForJid,
    clearTempBufferForJid,
} from "./conversation.service.js";
import {
    fetchFromSheet,
    getRowsFromSheetResponse,
    addStock,
    recordSale,
} from "./sheets.service.js";
import { getChatCompletion } from "./ai.service.js";
import { generateInventoryPdf } from "./pdf.service.js";
import fs from "fs";

/** Evita reintentos automáticos mientras cerramos la sesión a propósito (reset). */
let suppressReconnect = false;

const MAIN_MENU = `Hola, buen día. Soy tu agente de Indias motos. 🏍️
¿Qué deseas consultar hoy?

1. Ver estado de inventario 📦
2. Ingresar inventario ➕
3. Inventario vendido 🧾
4. Informe contable 📊

Responde con el número de la opción que desees o escribe "menu" en cualquier momento.`;

function formatCOP(value) {
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return String(value);
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
    }).format(n);
}

/** Formatea montos para informes: muestra $0 y negativos correctamente. */
function formatMoney(value) {
    const n = Math.round(Number(String(value).replace(/[^\d.-]/g, "")) || 0);
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
    }).format(n);
}

function formatInventoryCaption(row) {
    const title =
        row.nombre ??
        row.name ??
        row.producto ??
        row.articulo ??
        row.item ??
        "Ítem";
    const sku = row.sku ?? row.codigo ?? row.ref ?? row.referencia;
    const rawPrice = row.precio ?? row.price ?? row.valor;
    const stock = row.stock ?? row.cantidad ?? row.disponible;
    
    const lines = [`📦 *${title}*`];
    if (sku) lines.push(`Ref: ${sku}`);
    if (rawPrice != null && rawPrice !== "")
        lines.push(`💰 ${formatCOP(rawPrice)}`);
    if (stock != null && stock !== "") lines.push(`Stock: ${stock}`);
    
    return {
        caption: lines.join("\n"),
        photo: row.foto ?? row.photo ?? row.imagen ?? row.url_foto ?? row.image,
    };
}

/** Envía una fila de inventario como tarjeta (con foto si hay URL). */
async function sendProductCard(jid, row) {
    const { caption, photo } = formatInventoryCaption(row);
    if (photo && /^https?:\/\//i.test(photo)) {
        await sock.sendMessage(jid, { image: { url: photo }, caption });
    } else {
        await sock.sendMessage(jid, { text: caption });
    }
}

/** Extrae el primer entero del texto (cantidad). */
function parseQty(text) {
    const m = String(text).match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
}

/** Extrae un monto en pesos del texto: "25.000" o "$ 25000" -> 25000. */
function parseMoney(text) {
    const digits = String(text).replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : NaN;
}

export let sock = null;
export let lastQr = null;
export let isConnected = false;
export let connectionStatus = "idle";

export async function startBaileys() {
    if (sock) {
        suppressReconnect = true;
        try {
            sock.end(new Error("Reemplazo de socket Baileys"));
        } catch (_) {
            /* ignore */
        }
        sock = null;
        await new Promise((r) => setTimeout(r, 400));
        suppressReconnect = false;
    }

    console.log("🚀 Iniciando sistema unificado (Baileys + IA + Sheets)...");
    console.log("🐘 Sesión Baileys: PostgreSQL (tabla whatsapp_auth)");

    try {
        const { state, saveCreds } = await usePostgresAuthState();
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            browser: Browsers.appropriate("Chrome"),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
        });

        sock.ev.on("creds.update", saveCreds);

const TIMEOUT_DURATION = 5 * 60 * 1000; // 5 minutos
const userTimers = new Map();

function resetUserSession(jid) {
    setStateForJid(jid, "IDLE");
    clearTempBufferForJid(jid);
    if (userTimers.has(jid)) {
        clearTimeout(userTimers.get(jid));
        userTimers.delete(jid);
    }
}

function startUserTimer(jid) {
    if (userTimers.has(jid)) {
        clearTimeout(userTimers.get(jid));
    }
    const timer = setTimeout(() => {
        console.log(`🕒 Sesión expirada para ${jid}`);
        resetUserSession(jid);
    }, TIMEOUT_DURATION);
    userTimers.set(jid, timer);
}

// --- MANEJO DE MENSAJES ---
sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg?.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    if (!text || !jid) return;

    console.log(`📩 Mensaje recibido: "${text}"`);

    try {
        const state = getStateForJid(jid);
        const lower = text.toLowerCase();
        startUserTimer(jid);

        // 'menu' siempre disponible (corta cualquier flujo en curso)
        if (lower === "menu" || lower === "menú") {
            await sock.sendMessage(jid, { text: MAIN_MENU });
            setStateForJid(jid, "MAIN_MENU");
            clearTempBufferForJid(jid);
            return;
        }

        // Selección de menú
        if (state === "MAIN_MENU") {
            if (text === "1") {
                await sock.sendMessage(jid, { text: "¿Qué producto querés ver? Escribí una palabra clave (ej: aceite, llanta) o *todos* para el PDF." });
                setStateForJid(jid, "AWAITING_SEARCH");
            } else if (text === "2") {
                await sock.sendMessage(jid, { text: "Vamos a ingresar inventario. ¿Qué producto? Escribí el nombre o palabra clave (si ya existe, le sumamos stock)." });
                setStateForJid(jid, "AWAITING_ADD_SEARCH");
            } else if (text === "3") {
                await sock.sendMessage(jid, { text: "Vamos a registrar una venta. ¿Qué producto se vendió? (nombre o palabra clave)" });
                setStateForJid(jid, "AWAITING_SALE");
            } else if (text === "4") {
                await sock.sendMessage(jid, { text: "📊 ¿De qué período querés el informe?\n\n*1.* Quincena (la actual)\n*2.* Este mes" });
                setStateForJid(jid, "AWAITING_REPORT_PERIOD");
            } else {
                await sock.sendMessage(jid, { text: "Opción no válida. Elegí 1, 2, 3 o 4, o escribí *menu*." });
            }
            return;
        }

        // ---------- OPCIÓN 1: VER INVENTARIO (búsqueda determinista) ----------
        if (state === "AWAITING_SEARCH") {
            if (lower === "todos" || lower === "todo") {
                await sock.sendMessage(jid, { text: "Generando reporte PDF completo... 📄" });
                const result = await fetchFromSheet("getInventario", { q: "todos" });
                const rows = getRowsFromSheetResponse(result);
                if (result.success && rows.length > 0) {
                    const pdfPath = await generateInventoryPdf(rows);
                    await sock.sendMessage(jid, {
                        document: fs.readFileSync(pdfPath),
                        fileName: "Inventario_Indias_Motos.pdf",
                        mimetype: "application/pdf",
                    });
                    fs.unlinkSync(pdfPath);
                } else {
                    await sock.sendMessage(jid, { text: "No pude leer el inventario ahora. Intentá más tarde." });
                }
                return;
            }

            const query = text.replace(/^\d+\s+(de\s+)?/i, "").trim() || text;
            const result = await fetchFromSheet("getInventario", { q: query });
            const rows = getRowsFromSheetResponse(result);
            if (result.success && rows.length > 0) {
                for (const row of rows.slice(0, 5)) {
                    await sendProductCard(jid, row);
                }
                if (rows.length > 5) {
                    await sock.sendMessage(jid, { text: `… y ${rows.length - 5} más. Afiná con una palabra más específica.` });
                }
            } else {
                await sock.sendMessage(jid, { text: `No encontré "${text}". Probá otra palabra (ej: aceite, llanta) o escribí *menu*.` });
            }
            return;
        }

        // ---------- OPCIÓN 3: REGISTRAR VENTA (flujo determinista) ----------
        if (state === "AWAITING_SALE") {
            // Si escriben "2 llantas", quitamos la cantidad inicial para buscar solo el producto.
            const query = text.replace(/^\d+\s+(de\s+)?/i, "").trim() || text;
            const result = await fetchFromSheet("getInventario", { q: query });
            const rows = getRowsFromSheetResponse(result);
            if (!result.success || rows.length === 0) {
                await sock.sendMessage(jid, { text: `No encontré "${text}" en el inventario. Decime otro nombre o palabra clave (ej: aceite, llanta).` });
                return;
            }
            if (rows.length === 1) {
                setTempBufferForJid(jid, { product: rows[0] });
                await sock.sendMessage(jid, { text: `Seleccionaste *${rows[0].nombre}*.\n¿Cuántas unidades se vendieron?` });
                setStateForJid(jid, "AWAITING_SALE_QTY");
                return;
            }
            const candidates = rows.slice(0, 5);
            setTempBufferForJid(jid, { candidates });
            let listMsg = "Encontré varios, ¿cuál?\n";
            candidates.forEach((r, i) => {
                listMsg += `\n*${i + 1}.* ${r.nombre} — ${formatCOP(r.precio)} (stock ${r.stock})`;
            });
            listMsg += "\n\nRespondé con el número.";
            await sock.sendMessage(jid, { text: listMsg });
            setStateForJid(jid, "AWAITING_SALE_PICK");
            return;
        }

        if (state === "AWAITING_SALE_PICK") {
            const buf = getTempBufferForJid(jid);
            const idx = parseQty(text) - 1;
            if (!buf?.candidates || Number.isNaN(idx) || idx < 0 || idx >= buf.candidates.length) {
                await sock.sendMessage(jid, { text: "Respondé con el número de la lista (ej: 1)." });
                return;
            }
            const product = buf.candidates[idx];
            setTempBufferForJid(jid, { product });
            await sock.sendMessage(jid, { text: `Seleccionaste *${product.nombre}*.\n¿Cuántas unidades se vendieron?` });
            setStateForJid(jid, "AWAITING_SALE_QTY");
            return;
        }

        if (state === "AWAITING_SALE_QTY") {
            const buf = getTempBufferForJid(jid);
            const qty = parseQty(text);
            if (!buf?.product || Number.isNaN(qty) || qty <= 0) {
                await sock.sendMessage(jid, { text: "Decime un número válido de unidades (ej: 2)." });
                return;
            }
            const product = buf.product;
            const stock = Number(product.stock) || 0;
            if (qty > stock) {
                await sock.sendMessage(jid, { text: `Solo hay ${stock} de ${product.nombre}. Decime una cantidad menor o igual.` });
                return;
            }
            const total = (Number(product.precio) || 0) * qty;
            setTempBufferForJid(jid, { item: product.nombre, qty });
            await sock.sendMessage(jid, { text: `¿Confirmar venta de *${qty}x ${product.nombre}* a ${formatCOP(product.precio)} c/u = *${formatCOP(total)}*?\n\nRespondé *Si* o *No*.` });
            setStateForJid(jid, "CONFIRMING_SALE");
            return;
        }

        if (state === "CONFIRMING_SALE") {
            if (lower === "si" || lower === "sí" || lower === "confirmar" || text === "1") {
                const pending = getTempBufferForJid(jid);
                if (pending?.item) {
                    await sock.sendPresenceUpdate("composing", jid);
                    const res = await recordSale(pending.item, pending.qty);
                    await sock.sendMessage(jid, { text: res.success ? `✅ ${res.message || "Venta registrada."}` : `❌ ${res.error || "No pude registrar la venta."}` });
                }
                clearTempBufferForJid(jid);
                setStateForJid(jid, "IDLE");
                await sock.sendMessage(jid, { text: "Escribí *menu* para otra operación." });
            } else if (lower === "no" || text === "2") {
                clearTempBufferForJid(jid);
                setStateForJid(jid, "IDLE");
                await sock.sendMessage(jid, { text: "Venta cancelada. Escribí *menu* para otra operación." });
            } else {
                await sock.sendMessage(jid, { text: "Respondé *Si* para confirmar o *No* para cancelar." });
            }
            return;
        }

        // ---------- OPCIÓN 2: INGRESAR INVENTARIO (existente o nuevo) ----------
        if (state === "AWAITING_ADD_SEARCH") {
            const query = text.replace(/^\d+\s+(de\s+)?/i, "").trim() || text;
            const result = await fetchFromSheet("getInventario", { q: query });
            const rows = getRowsFromSheetResponse(result);
            if (result.success && rows.length > 0) {
                const candidates = rows.slice(0, 5);
                setTempBufferForJid(jid, { candidates });
                let listMsg = "¿A cuál le sumás stock?\n";
                candidates.forEach((r, i) => {
                    listMsg += `\n*${i + 1}.* ${r.nombre} (stock ${r.stock})`;
                });
                listMsg += `\n*${candidates.length + 1}.* ➕ Es un producto NUEVO`;
                listMsg += "\n\nRespondé con el número.";
                await sock.sendMessage(jid, { text: listMsg });
                setStateForJid(jid, "AWAITING_ADD_PICK");
            } else {
                setTempBufferForJid(jid, { name: text, isNew: true });
                await sock.sendMessage(jid, { text: `No existe "${text}", lo creo como producto NUEVO.\n¿Cuántas unidades vas a ingresar?` });
                setStateForJid(jid, "AWAITING_ADD_QTY");
            }
            return;
        }

        if (state === "AWAITING_ADD_PICK") {
            const buf = getTempBufferForJid(jid);
            const n = parseQty(text);
            const count = buf?.candidates?.length || 0;
            if (!buf?.candidates || Number.isNaN(n) || n < 1 || n > count + 1) {
                await sock.sendMessage(jid, { text: "Respondé con el número de la lista." });
                return;
            }
            if (n === count + 1) {
                setTempBufferForJid(jid, { isNew: true });
                await sock.sendMessage(jid, { text: "¿Cuál es el *nombre* del nuevo producto?" });
                setStateForJid(jid, "AWAITING_ADD_NAME");
                return;
            }
            const product = buf.candidates[n - 1];
            setTempBufferForJid(jid, { name: product.nombre, isNew: false });
            await sock.sendMessage(jid, { text: `Sumar stock a *${product.nombre}* (actual: ${product.stock}).\n¿Cuántas unidades vas a ingresar?` });
            setStateForJid(jid, "AWAITING_ADD_QTY");
            return;
        }

        if (state === "AWAITING_ADD_NAME") {
            setTempBufferForJid(jid, { name: text, isNew: true });
            await sock.sendMessage(jid, { text: `Producto nuevo: *${text}*.\n¿Cuántas unidades vas a ingresar?` });
            setStateForJid(jid, "AWAITING_ADD_QTY");
            return;
        }

        if (state === "AWAITING_ADD_QTY") {
            const buf = getTempBufferForJid(jid);
            const qty = parseQty(text);
            if (!buf?.name || Number.isNaN(qty) || qty <= 0) {
                await sock.sendMessage(jid, { text: "Decime un número válido de unidades (ej: 5)." });
                return;
            }
            setTempBufferForJid(jid, { ...buf, qty });
            await sock.sendMessage(jid, { text: "¿Cuál es el *costo* por unidad? (ej: 25000)" });
            setStateForJid(jid, "AWAITING_ADD_COST");
            return;
        }

        if (state === "AWAITING_ADD_COST") {
            const buf = getTempBufferForJid(jid);
            const cost = parseMoney(text);
            if (!buf?.name || Number.isNaN(cost) || cost <= 0) {
                await sock.sendMessage(jid, { text: "Decime un costo válido (ej: 25000)." });
                return;
            }
            await sock.sendPresenceUpdate("composing", jid);
            const res = await addStock(buf.name, buf.qty, cost, buf.isNew === true);
            await sock.sendMessage(jid, { text: res.success ? `✅ ${res.message || "Inventario actualizado."} (${buf.qty}x ${buf.name}, costo ${formatCOP(cost)})` : `❌ ${res.error || "No pude ingresar el inventario."}` });
            clearTempBufferForJid(jid);
            setStateForJid(jid, "IDLE");
            await sock.sendMessage(jid, { text: "Escribí *menu* para otra operación." });
            return;
        }

        // ---------- OPCIÓN 4: INFORME CONTABLE ----------
        if (state === "AWAITING_REPORT_PERIOD") {
            let period = null;
            if (lower.includes("quincena") || text === "1") period = "quincena";
            else if (lower.includes("mes") || text === "2") period = "mes";
            if (!period) {
                await sock.sendMessage(jid, { text: "Respondé *1* (quincena) o *2* (este mes)." });
                return;
            }
            await sock.sendPresenceUpdate("composing", jid);
            const result = await fetchFromSheet("getReporte", { period });
            if (result.success) {
                const msg =
                    `📊 *Informe contable — ${result.period}*\n\n` +
                    `🧾 Ventas: ${result.ventas}\n` +
                    `💰 Total vendido: ${formatMoney(result.ingresos)}\n` +
                    `📉 Gastos en inventario: ${formatMoney(result.egresos)}\n` +
                    `📈 Ganancia de ventas: ${formatMoney(result.ganancia)}\n` +
                    `💵 Flujo neto (ventas − gastos): ${formatMoney(result.neto)}`;
                await sock.sendMessage(jid, { text: msg });
            } else {
                await sock.sendMessage(jid, { text: `No pude generar el informe: ${result.error || "error"}` });
            }
            clearTempBufferForJid(jid);
            setStateForJid(jid, "IDLE");
            await sock.sendMessage(jid, { text: "Escribí *menu* para otra operación." });
            return;
        }

        // ---------- IDLE / charla libre (la IA NO ejecuta acciones) ----------
        const saludos = ["hola", "buenas", "buenos dias", "buenos días", "buen dia", "buen día", "buenas tardes", "buenas noches", "hey", "ola", "alo", "aló"];
        if (saludos.some((g) => lower === g || lower.startsWith(g + " "))) {
            await sock.sendMessage(jid, { text: "¡Hola! Soy el asistente de Indias Motos. 🏍️\nEscribí *menu* para ver las opciones." });
            return;
        }

        await sock.sendPresenceUpdate("composing", jid);
        const history = getHistoryForJid(jid);
        const aiResponse = await getChatCompletion(text, msg.pushName || "Cliente", history);
        const reply = aiResponse.replace(/\[.*?\]/g, "").trim() || "Escribí *menu* para ver las opciones.";
        await sock.sendMessage(jid, { text: reply });
        appendTurn(jid, text, reply);
        await sock.sendPresenceUpdate("paused", jid);

    } catch (err) {
        console.error("❌ Error en flujo:", err);
    }
});

        // --- MANEJO DE CONEXIÓN ---
        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                lastQr = qr;
                connectionStatus = "qr";
                console.log("✨ QR actualizado (Disponible en terminal y web)");
            }

            if (connection === "open") {
                isConnected = true;
                connectionStatus = "open";
                lastQr = null;
                console.log("✅ BOT CONECTADO Y FUNCIONANDO.");
            }

            if (connection === "close") {
                isConnected = false;
                connectionStatus = "close";
                lastQr = null;
                sock = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (!suppressReconnect && statusCode !== DisconnectReason.loggedOut) {
                    console.log("🔄 Conexión perdida, reintentando...");
                    setTimeout(() => startBaileys(), 5000);
                }
            }
        });

    } catch (err) {
        console.error("💥 Error Crítico en el arranque:", err);
    }
}

/**
 * Cierra WhatsApp, borra de Postgres toda la sesión almacenada y vuelve a iniciar Baileys.
 */
export async function resetSession() {
    suppressReconnect = true;
    lastQr = null;
    isConnected = false;
    connectionStatus = "idle";

    const old = sock;
    sock = null;
    if (old?.end) {
        try {
            old.end(new Error("Reset de sesión"));
        } catch (_) {
            /* ignore */
        }
    }

    await new Promise((r) => setTimeout(r, 500));

    await clearPostgresAuthState().catch((err) =>
        console.error("❌ Error borrando la sesión en Postgres:", err)
    );

    suppressReconnect = false;
    await startBaileys();
    return { success: true };
}
