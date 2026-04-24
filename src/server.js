import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import { config } from "./config/config.js";
import { getChatCompletion, extractSearchParameters } from "./ai.service.js";
import { fetchFromSheet, saveToSheet } from "./sheets.service.js";

export let sock = null;
export let lastQr = null;
export let isConnected = false;
export let connectionStatus = "idle";

// Helper de seguridad para las funciones de Baileys
const b = baileys.default || baileys;

export async function startBaileys() {
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
        });

        sock.ev.on("creds.update", saveCreds);

        // --- AQUÍ ES DONDE USAMOS LAS IMPORTACIONES (EL "OÍDO" DEL BOT) ---
        sock.ev.on("messages.upsert", async (m) => {
            const msg = m.messages?.[0];
            if (!msg?.message || msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!text) return;

            console.log(`📩 Usando IA para responder a: ${text}`);

            // 1. LLAMADA A LA IA (Usando getChatCompletion)
            const aiResponse = await getChatCompletion(text, msg.pushName || "Cliente");
            
            // 2. BUSQUEDA EN SHEETS (Usando extractSearchParameters y fetchFromSheet)
            const searchParams = extractSearchParameters(aiResponse);
            if (searchParams) {
                const action = searchParams.type === "rent" ? "getArriendo" : "getVenta";
                const sheetData = await fetchFromSheet(action, { city: searchParams.city });
                // ... lógica para enviar fotos de propiedades si existen ...
            }

            // 3. GUARDAR EN SHEETS (Usando saveToSheet)
            if (aiResponse.includes("[APPOINTMENT_SCHEDULED]")) {
                await saveToSheet({
                    name: msg.pushName || "Cliente",
                    phone: jid.split("@")[0],
                    details: text
                });
            }

            // ENVIAR RESPUESTA FINAL
            const cleanMessage = aiResponse.replace(/\[.*?\]/g, "").trim();
            await sock.sendMessage(jid, { text: cleanMessage });
        });

        sock.ev.on("connection.update", (update) => {
            const { connection, qr } = update;
            if (qr) { lastQr = qr; connectionStatus = "qr"; }
            if (connection === "open") {
                isConnected = true;
                connectionStatus = "open";
                console.log("✅ Conectado y usando todos los servicios (IA + Sheets)");
            }
        });

    } catch (err) {
        console.error("💥 Error:", err);
    }
}