import express from "express";
import * as baileys from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const { default: makeWASocket, useMultiFileAuthState } = baileys;

const app = express();
app.use(express.json());

let lastQr = null;
let sock = null;

async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState("/app/sessions");

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
  });
}

app.get("/", (req, res) => {
  res.send("OK. Visita /qr para escanear.");
});

app.get("/qr", async (req, res) => {
  if (!lastQr) return res.status(404).send("Aun no hay QR. Revisa Logs.");
  const dataUrl = await QRCode.toDataURL(lastQr);
  res.setHeader("Content-Type", "text/html");
  res.end(`<img src="${dataUrl}" />`);
});

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
