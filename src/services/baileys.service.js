import makeWASocket, {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { getChatCompletion, extractSearchParameters } from "./ai.service.js";
import { fetchFromSheet, saveToSheet } from "./sheets.service.js";

function sheetActionForParams(params) {
    const t = (params.type || "").toLowerCase();
    if (t === "rent") return "getArriendo";
    if (t === "sale") return "getVenta";
    return "getInventario";
}

function rowsFromSheetResult(result) {
    return result.propiedades || result.items || result.inventario || result.productos || [];
}

function formatInventoryCaption(row) {
    const title =
        row.nombre ??
        row.name ??
        row.producto ??
        row.address ??
        row.titulo ??
        "Ítem";
    const sku = row.sku ?? row.codigo ?? row.ref ?? row.referencia;
    const price = row.precio ?? row.price ?? row.valor;
    const city = row.ciudad ?? row.city ?? row.ubicacion ?? row.bodega;
    const stock = row.stock ?? row.cantidad ?? row.disponible;
    const lines = [`📦 ${title}`];
    if (sku) lines.push(`Ref: ${sku}`);
    if (price != null && price !== "") lines.push(`💰 $${price}`);
    if (city) lines.push(`📍 ${city}`);
    if (stock != null && stock !== "") lines.push(`Disponible: ${stock}`);
    return {
        caption: lines.join("\n"),
        photo: row.foto ?? row.photo ?? row.imagen ?? row.url_foto ?? row.image,
    };
}

export let sock = null;
export let lastQr = null;
export let isConnected = false;
export let connectionStatus = "idle";

export async function startBaileys() {
    console.log("🚀 Iniciando sistema unificado (Baileys + IA + Sheets)...");
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
        const { version } = await fetchLatestBaileysVersion();

        // browser debe ser [OS, navegador, versión] — ver Browsers en Baileys 7.
        // Usar el nombre de la empresa como "OS" rompe el registro y el QR nunca llega.
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

        // --- MANEJO DE MENSAJES CON IA Y SHEETS ---
        sock.ev.on("messages.upsert", async (m) => {
            const msg = m.messages?.[0];
            if (!msg?.message || msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!text || !jid) return;

            console.log(`📩 Mensaje recibido: "${text}"`);

            try {
                // Efecto "Escribiendo..."
                await sock.sendPresenceUpdate("composing", jid);

                // 1. Obtener respuesta de la IA
                const aiResponse = await getChatCompletion(text, msg.pushName || "Cliente");
                
                // 2. Procesar búsqueda en Sheets si la IA lo detecta
                const searchParams = extractSearchParameters(aiResponse);
                if (searchParams) {
                    console.log("🔍 IA solicitó consulta a Sheets:", searchParams);
                    const action = sheetActionForParams(searchParams);
                    const query = { ...searchParams };
                    delete query.type;
                    const result = await fetchFromSheet(action, query);
                    const rows = rowsFromSheetResult(result);

                    if (result.success && rows.length > 0) {
                        for (const row of rows.slice(0, 5)) {
                            const { caption, photo } = formatInventoryCaption(row);
                            const url = photo && String(photo).trim();
                            if (url && /^https?:\/\//i.test(url)) {
                                await sock.sendMessage(jid, {
                                    image: { url },
                                    caption,
                                });
                            } else {
                                await sock.sendMessage(jid, { text: caption });
                            }
                        }
                    }
                }

                // 3. Agendar cita en Sheets
                if (aiResponse.includes("[APPOINTMENT_SCHEDULED]")) {
                    await saveToSheet({
                        name: msg.pushName || "Cliente",
                        phone: jid.split("@")[0],
                        requestType: "🗓️ Cita",
                        details: text
                    });
                    console.log("📋 Cita guardada en Google Sheets");
                }

                // 4. Enviar respuesta de texto limpia
                const cleanMessage = aiResponse.replace(/\[.*?\]/g, "").trim();
                if (cleanMessage) {
                    await sock.sendMessage(jid, { text: cleanMessage });
                }

                await sock.sendPresenceUpdate("paused", jid);

            } catch (err) {
                console.error("❌ Error en el flujo de mensaje:", err);
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
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log("🔄 Conexión perdida, reintentando...");
                    setTimeout(() => startBaileys(), 5000);
                }
            }
        });

    } catch (err) {
        console.error("💥 Error Crítico en el arranque:", err);
    }
}

export async function resetSession() {
    return { success: true };
}