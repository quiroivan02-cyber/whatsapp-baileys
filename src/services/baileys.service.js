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
    saveToSheet,
    addStock,
    recordSale,
} from "./sheets.service.js";
import { getChatCompletion, extractSearchParameters, extractActionParameters } from "./ai.service.js";
import { generateInventoryPdf } from "./pdf.service.js";
import fs from "fs";

/** Evita reintentos automáticos mientras cerramos la sesión a propósito (reset). */
let suppressReconnect = false;

const MAIN_MENU = `Hola, buen día. Soy tu agente de Indias motos. 🏍️
¿Qué deseas consultar hoy?

1. Ver estado de inventario 📦
2. Ingresar inventario ➕
3. Inventario vendido 🧾

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

/** Le da a la IA el contexto de la opción de menú elegida, para que no adivine la intención. */
function buildIntentHint(state) {
    switch (state) {
        case "AWAITING_SEARCH":
            return "El usuario quiere BUSCAR o VER un producto del inventario.";
        case "AWAITING_SALE":
            return "El usuario quiere REGISTRAR UNA VENTA.";
        case "AWAITING_ADD_STOCK":
            return "El usuario quiere INGRESAR o agregar stock.";
        default:
            return "";
    }
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
        startUserTimer(jid);

        // 1. Comando 'menu' o 'menú' - Siempre disponible
        if (text.toLowerCase() === "menu" || text.toLowerCase() === "menú") {
            await sock.sendMessage(jid, { text: MAIN_MENU });
            setStateForJid(jid, "MAIN_MENU");
            return;
        }

        // 2. Estado inicial o expirado: Solo saludo básico
        if (state === "IDLE") {
            await sock.sendMessage(jid, { text: "Hola, soy tu asistente de Indias motos. 🏍️\n\nSi quieres ver el menú de opciones, escribe *menu*." });
            return;
        }

        // 3. Manejo de Selección de Menú (Paso de IDLE/IDLE_MENU a Acción)
        if (state === "MAIN_MENU") {
            if (text === "1") {
                await sock.sendMessage(jid, { text: "Entendido. ¿Qué producto o categoría deseas buscar? (o escribe 'todos' para el PDF)" });
                setStateForJid(jid, "AWAITING_SEARCH");
                return;
            } else if (text === "2") {
                await sock.sendMessage(jid, { text: "Por favor, dime qué producto vas a ingresar, la cantidad y el precio (ej: 5 Cascos a 80.000)" });
                setStateForJid(jid, "AWAITING_ADD_STOCK");
                return;
            } else if (text === "3") {
                await sock.sendMessage(jid, { text: "Por favor, dime qué producto se vendió y cuántas unidades (ej: Vendí 2 llantas)" });
                setStateForJid(jid, "AWAITING_SALE");
                return;
            } else {
                await sock.sendMessage(jid, { text: "Opción no válida. Por favor selecciona 1, 2 o 3, o escribe *menu* para ver las opciones." });
                return;
            }
        }

        // 4. Lógica de Confirmación de Venta (Alta prioridad)
        if (state === "CONFIRMING_SALE") {
            if (text.toLowerCase().includes("si") || text.toLowerCase().includes("confirmar") || text === "1") {
                const pendingSale = getTempBufferForJid(jid);
                if (pendingSale) {
                    await sock.sendPresenceUpdate("composing", jid);
                    const res = await recordSale(pendingSale.item, pendingSale.qty);
                    if (res.success) {
                        await sock.sendMessage(jid, { text: res.message ? `✅ ${res.message}` : "✅ Venta registrada con éxito. El stock se ha actualizado." });
                    } else {
                        await sock.sendMessage(jid, { text: `❌ Error: ${res.error}` });
                    }
                    clearTempBufferForJid(jid);
                    setStateForJid(jid, "AI_MODE"); // Mantener en modo IA tras acción
                    return;
                }
            } else if (text.toLowerCase().includes("no") || text === "2") {
                await sock.sendMessage(jid, { text: "Venta cancelada." });
                clearTempBufferForJid(jid);
                setStateForJid(jid, "AI_MODE");
                return;
            }
        }

        // 5. PDF Directo (Sin IA si está buscando)
        if (state === "AWAITING_SEARCH") {
            const isTodo = text.toLowerCase() === "todos" || text.toLowerCase() === "todo";
            if (isTodo) {
                await sock.sendMessage(jid, { text: "Generando reporte PDF completo... 📄" });
                const result = await fetchFromSheet("getInventario", { q: "todos" });
                const rows = getRowsFromSheetResponse(result);
                if (result.success && rows.length > 0) {
                    const pdfPath = await generateInventoryPdf(rows);
                    await sock.sendMessage(jid, {
                        document: fs.readFileSync(pdfPath),
                        fileName: "Inventario_Indias_Motos.pdf",
                        mimetype: "application/pdf"
                    });
                    fs.unlinkSync(pdfPath);
                    return;
                }
            }
        }

        // 6. MODO IA (Se activa tras elegir opción del menú)
        // Si el estado no es IDLE ni MAIN_MENU, asumimos que estamos procesando con IA
        await sock.sendPresenceUpdate("composing", jid);
        const history = getHistoryForJid(jid);
        const intentHint = buildIntentHint(state);
        const aiResponse = await getChatCompletion(text, msg.pushName || "Cliente", history, intentHint);

        // Procesar marcadores de la IA (Búsqueda, Venta, Stock)
        let didReply = false;

        const searchParams = extractSearchParameters(aiResponse);
        if (searchParams) {
            const result = await fetchFromSheet("getInventario", searchParams);
            const rows = getRowsFromSheetResponse(result);
            if (result.success && rows.length > 0) {
                for (const row of rows.slice(0, 5)) {
                    const { caption, photo } = formatInventoryCaption(row);
                    if (photo && /^https?:\/\//i.test(photo)) {
                        await sock.sendMessage(jid, { image: { url: photo }, caption });
                    } else {
                        await sock.sendMessage(jid, { text: caption });
                    }
                }
                didReply = true;
            }
            // Sin resultados: no mandamos "No encontré" acá; dejamos que el texto de la IA lo explique.
        }

        const saleParams = extractActionParameters(aiResponse, "RECORD_SALE");
        if (saleParams) {
            // 1. Ir al inventario a buscar el producto real antes de confirmar
            await sock.sendMessage(jid, { text: "Buscando producto en el inventario... 🔍" });
            const searchResult = await fetchFromSheet("getInventario", { q: saleParams.item });
            const foundRows = getRowsFromSheetResponse(searchResult);

            if (searchResult.success && foundRows.length > 0) {
                // Tomar el primer resultado encontrado
                const product = foundRows[0];
                const realName = product.nombre;
                const realPrice = product.precio;

                // 2. Guardar datos REALES de la hoja en el buffer
                setTempBufferForJid(jid, { 
                    item: realName, 
                    qty: saleParams.qty,
                    price: realPrice 
                });
                
                setStateForJid(jid, "CONFIRMING_SALE");
                
                // 3. Confirmar con datos exactos
                const confirmMsg = `¿Confirmar venta ${saleParams.qty} unidades de "${realName}" con precio de venta ${formatCOP(realPrice)}?\n\nResponde con *Si* para agregar a la base de datos o *No* para cancelar.`;
                await sock.sendMessage(jid, { text: confirmMsg });
            } else {
                // Si no se encuentra, pedir más claridad
                await sock.sendMessage(jid, { text: `❌ No encontré el producto "${saleParams.item}" en el inventario.\n\nPor favor, dime el nombre más exacto o una palabra clave clara (ej: "aceite", "filtro", "llanta").` });
                setStateForJid(jid, "AWAITING_SALE"); // Reintentar en el mismo estado
            }
            return;
        }

        const addParams = extractActionParameters(aiResponse, "ADD_STOCK");
        if (addParams) {
            const res = await addStock(addParams.item, addParams.qty, addParams.price);
            if (res.success) {
                await sock.sendMessage(jid, { text: `✅ Stock actualizado: ${addParams.qty} de "${addParams.item}".` });
                didReply = true;
            }
        }

        const cleanMessage = aiResponse.replace(/\[.*?\]/g, "").trim();
        if (cleanMessage) {
            await sock.sendMessage(jid, { text: cleanMessage });
            didReply = true;
        }

        // Si la IA no buscó, no vendió y no escribió nada útil, evitamos el silencio o el "No encontré" fuera de lugar.
        if (!didReply) {
            await sock.sendMessage(jid, { text: "No te entendí bien. Decime el nombre de un producto, o escribí *menu* para ver las opciones." });
        }

        appendTurn(jid, text, cleanMessage || "Procesado.");
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
