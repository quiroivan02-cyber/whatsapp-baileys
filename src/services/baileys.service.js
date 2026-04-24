import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
// Ruta corregida: sube un nivel para salir de 'services' y entra a 'config'
import { config } from "../config/config.js"; 
// Rutas locales: están en la misma carpeta 'services'
import { getChatCompletion, extractSearchParameters } from "./ai.service.js";
import { fetchFromSheet, saveToSheet } from "./sheets.service.js";

export let sock = null;
export let lastQr = null;
export let isConnected = false;
export let connectionStatus = "idle";

// Helper de seguridad para extraer funciones de Baileys
const b = baileys.default || baileys;

export async function startBaileys() {
    console.log("🚀 Iniciando sistema unificado (Baileys + IA + Sheets)...");
    
    try {
        const makeWASocket = b.makeWASocket || b.default || b;
        const { state, saveCreds } = await b.useMultiFileAuthState('auth_info_baileys');
        const { version } = await b.fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            printQRInTerminal: true,
            browser: [config.botConfig.company || "Bot", "Chrome", "121.0.0"],
            // Optimizaciones para no saturar el socket
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
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
                    console.log("🔍 IA solicitó búsqueda en Sheets:", searchParams);
                    const action = searchParams.type === "rent" ? "getArriendo" : "getVenta";
                    const result = await fetchFromSheet(action, { 
                        city: searchParams.city,
                        price: searchParams.price 
                    });

                    if (result.success && result.propiedades?.length > 0) {
                        for (const prop of result.propiedades.slice(0, 3)) {
                            const caption = `🏠 *${prop.address}*\n💰 Precio: $${prop.price}\n📍 Ciudad: ${prop.city}`;
                            await sock.sendMessage(jid, { image: { url: prop.photo }, caption });
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
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== b.DisconnectReason.loggedOut) {
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