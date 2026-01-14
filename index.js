import express from "express";
import * as baileysNS from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import fs from "fs/promises";

// ---- Baileys import robusto (ESM/CJS) ----
const baileysMod = baileysNS?.default ?? baileysNS;

const makeWASocket =
  typeof baileysMod === "function"
    ? baileysMod
    : baileysMod?.makeWASocket ?? baileysMod?.default;

const useMultiFileAuthState =
  baileysMod?.useMultiFileAuthState ?? baileysNS?.useMultiFileAuthState;

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

// ---- Helpers ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, wait(ms)]);

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function safeCloseSocket() {
  // Evita cuelgues en logout cuando la sesión está mala
  try {
    await withTimeout(sock?.logout?.(), 3000);
  } catch (_) {}
  try {
    sock?.end?.();
  } catch (_) {}
  sock = null;
}

async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState("/app/sessions"); // Volume
  sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    console.log("connection.update", {
      connection,
      hasQr: !!qr,
      statusCode: lastDisconnect?.error?.output?.statusCode,
      error: lastDisconnect?.error?.message,
    });

    if (qr) lastQr = qr;

    // Si se cierra, borra QR para que /qr no muestre uno viejo
    if (connection === "close") lastQr = null;
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
    await safeCloseSocket();

    // Borra credenciales guardadas y crea carpeta limpia
    await fs.rm("/app/sessions", { recursive: true, force: true });
    await fs.mkdir("/app/sessions", { recursive: true });

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
      return res
        .status(404)
        .send("Aun no hay QR. Revisa Logs o usa /restart o /reset.");
    }
    const dataUrl = await QRCode.toDataURL(lastQr);
    res.setHeader("Content-Type", "text/html");
    res.end(`<img src="${dataUrl}" />`);
  })
);

// Clickeables en navegador
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

// Por si lo llamas desde n8n (POST)
app.post(
  "/restart",
  asyncHandler(async (_req, res) => {
    await restartBaileys();
    res.json({ ok: true });
  })
);

app.post(
  "/reset",
  asyncHandler(async (_req, res) => {
    await resetSession();
    res.json({ ok: true });
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
app.listen(port, "0.0.0.0", () => {
  console.log("Server listening on", port);
  startBaileys().catch((e) => console.error("startBaileys failed", e));
});

