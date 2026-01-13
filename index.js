import express from "express";
import * as baileysNS from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import fs from "fs/promises";

// Resolver exports (ESM/CJS) de Baileys de forma robusta
const baileysMod = baileysNS?.default ?? baileysNS;

// En algunas builds, el módulo exporta { makeWASocket, useMultiFileAuthState }
// en otras, el export default es directamente la función
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

const app = express();
app.use(express.json());

// Healthcheck para Railway
app.get("/health", (req, res) => res.sendStatus(200));

let lastQr = null;
let sock = null;

// Evita restarts/resets simultáneos
let restarting = false;

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
    if (connection === "close") {
      lastQr = null;
    }
  });
}

async function restartBaileys() {
  if (restarting) return;
  restarting = true;

  try {
    lastQr = null;

    // Cierra el socket actual (si existe)
    try { await sock?.logout?.(); } catch (_) {}
    try { sock?.end?.(); } catch (_) {}

    sock = null;

    // Arranca uno nuevo (emitirá QR si no hay sesión válida)
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

    // Cierra el socket actual
    try { await sock?.logout?.(); } catch (_) {}
    try { sock?.end?.(); } catch (_) {}
    sock = null;

    // Borra credenciales guardadas y crea carpeta limpia
    await fs.rm("/app/sessions", { recursive: true, force: true });
    await fs.mkdir("/app/sessions", { recursive: true });

    await startBaileys();
  } finally {
    restarting = false;
  }
}

// Rutas base
app.get("/", (req, res) => {
  res.send("OK. Visita /qr para escanear.");
});

app.get("/qr", async (req, res) => {
  if (!lastQr) return res.status(404).send("Aun no hay QR. Revisa Logs o usa /restart o /reset.");
  const dataUrl = await QRCode.toDataURL(lastQr);
  res.setHeader("Content-Type", "text/html");
  res.end(`<img src="${dataUrl}" />`);
});

// Clickeables (GET) y también POST por si luego los usas desde n8n
app.get("/restart", async (req, res) => {
  await restartBaileys();
  res.send("ok");
});

app.post("/restart", async (req, res) => {
  await restartBaileys();
  res.json({ ok: true });
});

app.get("/reset", async (req, res) => {
  await resetSession();
  res.send("ok");
});

app.post("/reset", async (req, res) => {
  await resetSession();
  res.json({ ok: true });
});

// Endpoint para enviar mensajes desde n8n
app.post("/send", async (req, res) => {
  try {
    const { to, text } = req.body;
    if (!sock) return res.status(503).json({ ok: false, error: "Socket no iniciado" });
    await sock.sendMessage(to, { text });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log("Server listening on", port);
  startBaileys();
});
