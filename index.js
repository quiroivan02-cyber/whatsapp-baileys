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

// Normaliza URLs con doble slash (//reset => /reset)
app.use((req, _res, next) => {
  req.url = req.url.replace(/\/{2,}/g, "/");
  next();
});

// Healthcheck para Railway
app.get("/health", (_req, res) => res.sendStatus(200));

// ---- Estado global ----
let lastQr = null;
let sock = null;
let restarting = false;
let pairingRequested = false;

// ---- Helpers ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, wait(ms)]);

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function safeCloseSocket() {
  try {
    await withTimeout(sock?.logout?.(), 3000);
  } catch (_) {}
  try {
    sock?.end?.();
  } catch (_) {}
  sock = null;
}

async function emptyDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  const items = await fs.readdir(dir);
  await Promise.all(
    items.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true }))
  );
}

async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState("/app/sessions");

  sock = makeWASocket({
    auth: state,
    // importante: para pairing code, que NO imprima QR en terminal
    printQRInTerminal: false,
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
    if (connection === "close") lastQr = null;

    // Pedir pairing code (solo si NO está registrado)
    if (
      !pairingRequested &&
      !sock.authState.creds.registered &&
      (connection === "connecting" || !!qr)
    ) {
      pairingRequested = true;
      const phone = (process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
      if (phone) {
        const code = await sock.requestPairingCode(phone);
        console.log("PAIRING CODE:", code);
      } else {
        pairingRequested = false;
      }
    }

    // 515 => restartRequired: recrea socket
    if (connection === "close" && statusCode === DisconnectReason?.restartRequired) {
      setTimeout(() => {
        restartBaileys().catch((e) => console.error("restartBaileys failed", e));
      }, 1000);
    }

    // 401 => loggedOut: toca /reset y volver a vincular
    if (connection === "close" && statusCode === DisconnectReason?.loggedOut) {
      console.log("Logged out (401). Usa /reset y vuelve a vincular.");
    }
  });
}

async function restartBaileys() {
  if (restarting) return;
  restarting = true;

  try {
    lastQr = null;
    await safeCloseSocket();
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
    pairingRequested = false;

    await safeCloseSocket();

    // Vacía el volumen (no intentes borrar /app/sessions completo)
    await emptyDir("/app/sessions");

    await startBaileys();
  } finally {
    restarting = false;
  }
}

// ---- Routes ----
app.get("/", (_req, res) => {
  res.send("OK. Visita /qr para escanear.");
});

app.get(
  "/qr",
  asyncHandler(async (_req, res) => {
    if (!lastQr) {
      return res.status(404).send("Aun no hay QR. Revisa Logs o usa /restart o /reset.");
    }
    const dataUrl = await QRCode.toDataURL(lastQr);
    res.setHeader("Content-Type", "text/html");
    res.end(`<img src="${dataUrl}" />`);
  })
);

app.get(
  "/restart",
  asyncHandler(async (_req, res) => {
    await restartBaileys();
    res.send("ok");
  })
);

app.get(
  "/reset",
  asyncHandler(async (_req, res) => {
    await resetSession();
    res.send("ok");
  })
);

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

// Error handler (siempre al final)
app.use((err, _req, res, _next) => {
  console.error("ERR", err);
  res.status(500).send(err?.message || "error");
});

// ---- Listen ----
const port = process.env.PORT || 3000;
app.listen(port, "::", () => {
  console.log("Server listening on", port);
  startBaileys().catch((e) => console.error("startBaileys failed", e));
});

