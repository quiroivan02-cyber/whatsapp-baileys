import express from "express";
import * as baileysNS from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import path from "path";
import fs from "fs/promises";

// ---- Baileys import robusto (ESM/CJS) ----
const baileysMod = baileysNS?.default ?? baileysNS;

const makeWASocket =
  typeof baileysMod === "function"
    ? baileysMod
    : baileysMod?.makeWASocket ?? baileysMod?.default;

const useMultiFileAuthState =
  baileysMod?.useMultiFileAuthState ?? baileysNS?.useMultiFileAuthState;

const DisconnectReason =
  baileysMod?.DisconnectReason ?? baileysNS?.DisconnectReason;

if (typeof makeWASocket !== "function") {
  throw new Error("makeWASocket no es una función (revisa versión/import de Baileys)");
}
if (typeof useMultiFileAuthState !== "function") {
  throw new Error("useMultiFileAuthState no es una función (revisa versión/import de Baileys)");
}

// ---- Express ----
const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  req.url = req.url.replace(/\/{2,}/g, "/");
  next();
});

app.get("/health", (_req, res) => res.sendStatus(200));

// ---- Estado global ----
let lastQr = null;
let sock = null;
let restarting = false;

// ---- Helpers ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function emptyDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  const items = await fs.readdir(dir);
  await Promise.all(
    items.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true }))
  );
}

// Cierre duro: evita sockets "zombies" durante restart
async function hardCloseSocket() {
  try {
    sock?.ws?.close?.();
  } catch (_) {}
  try {
    sock?.ws?.terminate?.();
  } catch (_) {}
  try {
    sock?.end?.();
  } catch (_) {}
  sock = null;
}

async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState("/app/sessions");

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    console.log("connection.update", {
      connection,
      hasQr: !!qr,
      statusCode,
      error: lastDisconnect?.error?.message,
    });

    if (qr) lastQr = qr;

    if (connection === "open") {
      lastQr = null;
      console.log("connected to WA");
    }

    if (connection === "close") {
      lastQr = null;

      if (statusCode === DisconnectReason?.restartRequired) {
        console.log("restartRequired (515). Reiniciando socket...");
        await restartBaileys({ delayMs: 10000 });
        return;
      }

      if (statusCode === DisconnectReason?.loggedOut) {
        console.log("loggedOut (401). Usa /reset y vuelve a escanear el QR.");
        return;
      }

      console.log("connection closed. Reintentando...");
      setTimeout(() => {
        restartBaileys({ delayMs: 3000 }).catch((e) => console.error("restartBaileys failed", e));
      }, 1000);
    }
  });

  // ---- LISTENER DE MENSAJES (integración con n8n) ----
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (!jid || !text) continue;

      console.log("📩 Mensaje recibido de", jid, ":", text);

      const payload = {
        jid,
        text,
        messageId: msg.key.id,
        pushName: msg.pushName || null,
        from: msg.key.participant || jid,
      };

      let reply = "No pude obtener respuesta del bot.";

      try {
        const r = await fetch(process.env.N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await r.json();
        // ⬇️ CAMBIO AQUÍ: buscar 'message' primero, luego 'reply'
        reply = data?.message || data?.reply || "No pude obtener respuesta del bot.";
        console.log("✅ Respuesta de n8n recibida:", reply);
      } catch (e) {
        console.error("❌ n8n webhook error:", e?.message || e);
      }

      console.log("📤 Enviando respuesta:", reply);
      await sock.sendMessage(jid, { text: reply });
    }
  });
}

async function restartBaileys({ delayMs = 3000 } = {}) {
  if (restarting) return;
  restarting = true;

  try {
    await hardCloseSocket();
    await wait(delayMs);
    await startBaileys();
  } finally {
    restarting = false;
  }
}

async function resetSession() {
  if (restarting) return;
  restarting = true;

  try {
    lastQr = null;
    await hardCloseSocket();
    await wait(1500);
    await emptyDir("/app/sessions");
    await startBaileys();
  } finally {
    restarting = false;
  }
}

// ---- Routes ----
app.get("/", (_req, res) => res.send("OK. Visita /qr para escanear."));

app.get(
  "/qr",
  asyncHandler(async (_req, res) => {
    if (!lastQr) return res.status(404).send("Aun no hay QR. Abre /reset y revisa de nuevo.");
    const dataUrl = await QRCode.toDataURL(lastQr);
    res.setHeader("Content-Type", "text/html");
    res.end(`<img src="${dataUrl}" />`);
  })
);

app.get("/restart", asyncHandler(async (_req, res) => { await restartBaileys({ delayMs: 3000 }); res.send("ok"); }));
app.get("/reset", asyncHandler(async (_req, res) => { await resetSession(); res.send("ok"); }));

app.post(
  "/send",
  asyncHandler(async (req, res) => {
    const { to, text } = req.body || {};
    if (!sock) return res.status(503).json({ ok: false, error: "Socket no iniciado" });
    if (!to || !text) return res.status(400).json({ ok: false, error: "Falta to o text" });
    await sock.sendMessage(to, { text });
    res.json({ ok: true });
  })
);

app.use((err, _req, res, _next) => {
  console.error("ERR", err);
  res.status(500).send(err?.message || "error");
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log("Server listening on", port);
  startBaileys().catch((e) => console.error("startBaileys failed", e));
});
