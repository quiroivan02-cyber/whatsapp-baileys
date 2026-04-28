import makeWASocket, {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { rm } from "fs/promises";
import path from "path";
import pino from "pino";
import { config } from "../config/config.js";
import { getChatCompletion, extractSearchParameters } from "./ai.service.js";
import {
    appendTurn,
    getHistoryForJid,
    getLastSheetQueryKey,
    setLastSheetQueryKey,
} from "./conversation.service.js";
import {
    buildSheetQueryKey,
    fetchFromSheet,
    getRowsFromSheetResponse,
    saveToSheet,
} from "./sheets.service.js";

/** Evita reintentos automáticos mientras cerramos la sesión a propósito (reset). */
let suppressReconnect = false;

function resolveAuthFolder() {
    const dir = config.baileysAuthDir || "auth_info_baileys";
    return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

function sheetActionForParams(params) {
    const t = (params.type || "").toLowerCase();
    if (t === "rent") return "getArriendo";
    if (t === "sale") return "getVenta";
    return "getInventario";
}

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
        row.address ??
        row.direccion ??
        row.titulo ??
        "Ítem";
    const sku = row.sku ?? row.codigo ?? row.ref ?? row.referencia;
    const rawPrice = row.precio ?? row.price ?? row.valor;
    const city = row.ciudad ?? row.city ?? row.ubicacion ?? row.bodega;
    const stock = row.stock ?? row.cantidad ?? row.disponible;
    const op = String(row.listingType || row.type || "").toLowerCase();
    let badge = "";
    if (op === "rent") badge = "🔑 Arriendo · ";
    else if (op === "sale") badge = "🏷️ Venta · ";
    const lines = [`${badge}📦 ${title}`];
    if (sku) lines.push(`Ref: ${sku}`);
    if (rawPrice != null && rawPrice !== "")
        lines.push(`💰 ${formatCOP(rawPrice)}`);
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

    const authFolder = resolveAuthFolder();
    console.log("🚀 Iniciando sistema unificado (Baileys + IA + Sheets)...");
    console.log(`📁 Sesión Baileys: ${authFolder}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
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

                // 1. IA con historial de este chat (mismo JID)
                const history = getHistoryForJid(jid);
                const aiResponse = await getChatCompletion(text, msg.pushName || "Cliente", history);
                
                // 2. Procesar búsqueda en Sheets si la IA lo detecta
                const searchParams = extractSearchParameters(aiResponse);
                if (searchParams) {
                    const action = sheetActionForParams(searchParams);
                    const query = { ...searchParams };
                    delete query.type;
                    const sheetKey = buildSheetQueryKey(action, query);
                    const prevKey = getLastSheetQueryKey(jid);

                    if (sheetKey === prevKey) {
                        console.log(
                            "⏭️ Misma consulta Sheets que la anterior; no repito fichas."
                        );
                    } else {
                        console.log("🔍 IA solicitó consulta a Sheets:", searchParams);
                        const result = await fetchFromSheet(action, query);
                        const rows = getRowsFromSheetResponse(result);

                        if (result.success) {
                            setLastSheetQueryKey(jid, sheetKey);
                        }

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

                appendTurn(
                    jid,
                    text,
                    cleanMessage ||
                        (searchParams
                            ? "Te envío opciones del inventario en los mensajes de arriba."
                            : aiResponse.replace(/\[[^\]]*\]/g, "").trim() || "…")
                );

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
 * Cierra WhatsApp, borra del disco todos los JSON de sesión (libera espacio) y vuelve a iniciar Baileys.
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

    const authFolder = resolveAuthFolder();
    await rm(authFolder, { recursive: true, force: true }).catch(() => {});

    suppressReconnect = false;
    await startBaileys();
    return { success: true };
}