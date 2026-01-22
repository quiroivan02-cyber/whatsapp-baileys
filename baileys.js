// ========================================
// LÓGICA DE WHATSAPP CON BAILEYS
// ========================================

import * as baileysNS from "@whiskeysockets/baileys";
import fs from "fs/promises";
import { config } from './config.js';
import { guardarEnGoogleSheet } from './sheets.js';
import { consultarGroq, detectarTipoSolicitud, extraerParametrosBusqueda } from './groq.js';
import { obtenerPropiedadesArriendo, obtenerPropiedadesVenta, formatearPropiedades } from './propiedades.js';

// ========================================
// MEMORIA DE CONVERSACIONES
// ========================================

/**
 * Almacena el historial de conversación por usuario
 * Formato: { 'numero': [{ role: 'user', content: 'mensaje' }] }
 */
const conversaciones = new Map();

/**
 * Límite de mensajes a recordar por usuario
 */
const MAX_MENSAJES_HISTORIAL = 10;

/**
 * Obtiene el historial de un usuario
 */
function obtenerHistorial(telefono) {
  if (!conversaciones.has(telefono)) {
    conversaciones.set(telefono, []);
  }
  return conversaciones.get(telefono);
}

/**
 * Agrega un mensaje al historial
 */
function agregarAlHistorial(telefono, role, content) {
  const historial = obtenerHistorial(telefono);
  historial.push({ role, content });
  
  // Mantener solo los últimos MAX_MENSAJES_HISTORIAL mensajes
  if (historial.length > MAX_MENSAJES_HISTORIAL * 2) {
    historial.shift(); // Eliminar el más antiguo
    historial.shift();
  }
  
  conversaciones.set(telefono, historial);
}

/**
 * Limpia el historial de un usuario
 */
function limpiarHistorial(telefono) {
  conversaciones.delete(telefono);
}

// Configuración de Baileys
const baileysMod = baileysNS?.default ?? baileysNS;

export const makeWASocket = typeof baileysMod === "function"
  ? baileysMod
  : baileysMod?.makeWASocket ?? baileysMod?.default;

export const useMultiFileAuthState =
  baileysMod?.useMultiFileAuthState ?? baileysNS?.useMultiFileAuthState;

export const DisconnectReason =
  baileysMod?.DisconnectReason ?? baileysNS?.DisconnectReason;

// Validaciones
if (typeof makeWASocket !== "function") {
  throw new Error("makeWASocket no es una función");
}
if (typeof useMultiFileAuthState !== "function") {
  throw new Error("useMultiFileAuthState no es una función");
}

// Estado global
export let lastQr = null;
export let sock = null;
export let isConnected = false;
let restarting = false;

// Helpers
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function emptyDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  const items = await fs.readdir(dir);
  await Promise.all(
    items.map((name) => fs.rm(`${dir}/${name}`, { recursive: true, force: true }))
  );
}

async function hardCloseSocket() {
  try { 
    detenerHeartbeat(); // Detener heartbeat antes de cerrar
    sock?.ws?.close?.(); 
  } catch (_) {}
  try { sock?.ws?.terminate?.(); } catch (_) {}
  try { sock?.end?.(); } catch (_) {}
  sock = null;
  isConnected = false;
}

// ========================================
// SISTEMA DE KEEP-ALIVE
// ========================================

let heartbeatInterval = null;
let monitorInterval = null;

/**
 * Inicia el heartbeat para mantener conexión activa
 */
function iniciarHeartbeat() {
  if (heartbeatInterval) return;
  
  console.log('💓 Iniciando heartbeat...');
  
  heartbeatInterval = setInterval(() => {
    if (sock && isConnected) {
      console.log('💓 Heartbeat - Conexión activa');
      
      // Enviar presencia para mantener activo
      sock.sendPresenceUpdate('available').catch((err) => {
        console.log('⚠️ Error en heartbeat:', err.message);
      });
    }
  }, 60000); // Cada 60 segundos
}

/**
 * Detiene el heartbeat
 */
function detenerHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('💔 Heartbeat detenido');
  }
}

/**
 * Monitor de conexión - verifica estado cada 2 minutos
 */
function iniciarMonitor() {
  if (monitorInterval) return;
  
  console.log('🔍 Iniciando monitor de conexión...');
  
  monitorInterval = setInterval(async () => {
    console.log('🔍 Verificando estado de conexión...');
    
    // Si el socket existe pero no está conectado, intentar reconectar
    if (sock && !isConnected && !restarting) {
      console.log('⚠️ Detectada desconexión silenciosa. Reconectando...');
      await restartBaileys({ delayMs: 5000 });
    }
  }, 120000); // Cada 2 minutos
}

/**
 * Detiene el monitor
 */
function detenerMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('🔍 Monitor detenido');
  }
}

/**
 * Procesa los mensajes recibidos
 */
async function procesarMensaje(msg) {
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const nombre = msg.pushName || 'Cliente';
  const telefono = jid.replace('@s.whatsapp.net', '');
  const texto = msg.message?.conversation || 
                msg.message?.extendedTextMessage?.text || '';

  if (!jid || !texto) return;

  console.log('📩 Mensaje recibido:');
  console.log('   De:', nombre, `(${telefono})`);
  console.log('   Mensaje:', texto);

  let respuesta = '';
  let tipoSolicitud = 'Consulta general';

  // Comandos especiales
  const textoLower = texto.toLowerCase().trim();
  
  // Comando para reiniciar conversación
  if (textoLower === '!reset' || textoLower === 'reiniciar') {
    limpiarHistorial(telefono);
    respuesta = `✅ Conversación reiniciada.\n\nHola ${nombre}, soy ${config.BOT_CONFIG.vendedor} de ${config.BOT_CONFIG.empresa}.\n\n¿En qué puedo ayudarte?`;
    tipoSolicitud = 'Reinicio';
  }
  // Menú
  else if (textoLower === '!menu' || textoLower === 'menu') {
    limpiarHistorial(telefono);
    respuesta = `🏠 *${config.BOT_CONFIG.empresa}*\n\nHola ${nombre}! Soy ${config.BOT_CONFIG.vendedor}, tu asesora inmobiliaria. 😊\n\n¿En qué puedo ayudarte?\n\n1️⃣ Comprar propiedad\n2️⃣ Vender propiedad\n3️⃣ Arrendar\n4️⃣ Ver catálogo\n\nEscribe el número o cuéntame qué buscas.`;
    tipoSolicitud = 'Menú';
  }
  // Opción 1: Compra
  else if (texto === '1') {
    limpiarHistorial(telefono);
    respuesta = `¡Excelente decisión! 🎉\n\n¿En qué ciudad buscas?\n¿Y cuál es tu presupuesto aproximado?`;
    tipoSolicitud = 'Compra';
  }
  // Opción 2: Venta
  else if (texto === '2') {
    limpiarHistorial(telefono);
    respuesta = `¡Perfecto! Te ayudo a vender tu propiedad. 💼\n\n¿Qué tipo de propiedad es?\n¿En qué zona está ubicada?\n¿Cuál es el valor aproximado?`;
    tipoSolicitud = 'Venta';
  }
  // Opción 3: Arriendo
  else if (texto === '3') {
    limpiarHistorial(telefono);
    respuesta = `¡Claro! 🏢\n\n¿En qué ciudad buscas?\n¿Cuál es tu presupuesto mensual?`;
    tipoSolicitud = 'Arriendo';
  }
  // Opción 4: Catálogo
  else if (texto === '4') {
    limpiarHistorial(telefono);
    respuesta = `📱 Te muestro el catálogo.\n\n¿Buscas para comprar o arrendar?\n¿En qué ciudad?`;
    tipoSolicitud = 'Catálogo';
  }
  // Conversación normal con IA (CON MEMORIA)
  else {
    // Agregar mensaje del usuario al historial
    agregarAlHistorial(telefono, 'user', `${nombre} dice: ${texto}`);
    
    // Obtener respuesta con contexto
    const historial = obtenerHistorial(telefono);
    respuesta = await consultarGroq(texto, nombre, historial);
    
    // Agregar respuesta de la IA al historial
    agregarAlHistorial(telefono, 'assistant', respuesta);
    
    // Detectar tipo de solicitud
    tipoSolicitud = detectarTipoSolicitud(texto);
  }

  // ========================================
  // BÚSQUEDA DE PROPIEDADES
  // ========================================
  
  const parametrosBusqueda = extraerParametrosBusqueda(respuesta);
  
  if (parametrosBusqueda) {
    console.log('🔍 Búsqueda de propiedades solicitada');
    
    const tipo = parametrosBusqueda.tipo || 'arriendo';
    const ciudad = parametrosBusqueda.ciudad || '';
    const precio = parametrosBusqueda.precio ? parseFloat(parametrosBusqueda.precio) : null;
    
    // Consultar propiedades según tipo
    let resultado;
    if (tipo === 'venta' || tipo === 'compra') {
      resultado = await obtenerPropiedadesVenta(ciudad, precio);
    } else {
      resultado = await obtenerPropiedadesArriendo(ciudad, precio);
    }
    
    // Formatear propiedades para WhatsApp
    if (resultado.success && resultado.propiedades.length > 0) {
      const propiedadesFormateadas = formatearPropiedades(resultado.propiedades, 5);
      
      // Limpiar marcador y agregar propiedades
      respuesta = respuesta.replace(/\[BUSCAR_PROPIEDADES:[^\]]+\]/, '').trim();
      respuesta += `\n\n${propiedadesFormateadas}`;
      
      // Enviar fotos si existen
      for (let i = 0; i < Math.min(3, resultado.propiedades.length); i++) {
        const prop = resultado.propiedades[i];
        if (prop.foto && prop.foto.startsWith('http')) {
          try {
            await sock.sendMessage(jid, {
              image: { url: prop.foto },
              caption: `📍 ${prop.direccion}, ${prop.ciudad}\n💰 $${prop.precio.toLocaleString('es-CO')}`
            });
          } catch (error) {
            console.log('⚠️ Error enviando foto:', error.message);
          }
        }
      }
    } else {
      respuesta = respuesta.replace(/\[BUSCAR_PROPIEDADES:[^\]]+\]/, '').trim();
      respuesta += '\n\nNo encontré propiedades con esos criterios. ¿Quieres buscar en otra ciudad o con otro presupuesto?';
    }
  }

  // ========================================
  // SISTEMA DE CONFIRMACIÓN DE CITAS
  // ========================================
  
  // 1. Detectar si está pidiendo confirmación
  const solicitandoConfirmacion = respuesta.includes('[CONFIRMAR_CITA]');
  
  // 2. Detectar si la cita fue confirmada por el usuario
  const citaConfirmada = respuesta.includes('[CITA_AGENDADA]');
  
  // Limpiar marcadores de la respuesta
  let respuestaLimpia = respuesta
    .replace('[CONFIRMAR_CITA]', '')
    .replace('[CITA_AGENDADA]', '')
    .trim();
  
  // Variables para guardar
  let detallesCita = '';
  let guardarEnSheet = false;
  
  // Si está solicitando confirmación, NO guardar aún
  if (solicitandoConfirmacion) {
    console.log('⏳ Esperando confirmación del usuario...');
    tipoSolicitud = 'Confirmando cita';
    guardarEnSheet = false;
  }
  
  // Si la cita fue confirmada, guardar
  if (citaConfirmada) {
    tipoSolicitud = '🗓️ Cita Agendada';
    detallesCita = respuestaLimpia;
    guardarEnSheet = true;
    console.log('✅ Cita confirmada por el usuario');
  }

  // Guardar en Google Sheets SOLO si hay confirmación
  if (guardarEnSheet) {
    await guardarEnGoogleSheet(nombre, telefono, tipoSolicitud, detallesCita);
  }

  // Enviar respuesta limpia
  console.log('📤 Enviando respuesta...');
  await sock.sendMessage(jid, { text: respuestaLimpia });
}

/**
 * Inicia la conexión de WhatsApp
 */
export async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState(config.SESSIONS_DIR);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000, // 60 segundos
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000, // Keep-alive cada 30 seg
    retryRequestDelayMs: 250,
    maxMsgRetryCount: 5,
    browser: ['Inmobiliaria Prime Bot', 'Chrome', '120.0.0'],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    console.log("📡 connection.update", { connection, hasQr: !!qr, statusCode });

    if (qr) {
      lastQr = qr;
      console.log("📱 QR generado. Visita /qr");
    }

    if (connection === "open") {
      lastQr = null;
      isConnected = true;
      console.log("✅ Conectado a WhatsApp");
      
      // Iniciar sistemas de mantenimiento
      iniciarHeartbeat();
      iniciarMonitor();
    }

    if (connection === "close") {
      lastQr = null;
      isConnected = false;
      
      // Detener sistemas de mantenimiento
      detenerHeartbeat();
      detenerMonitor();

      if (statusCode === DisconnectReason?.restartRequired) {
        console.log("🔄 Restart requerido");
        await restartBaileys({ delayMs: 10000 });
        return;
      }

      if (statusCode === DisconnectReason?.loggedOut) {
        console.log("🚪 Sesión cerrada. Usa /reset");
        return;
      }

      console.log("⚠️ Conexión cerrada. Reintentando...");
      setTimeout(() => {
        restartBaileys({ delayMs: 3000 }).catch(console.error);
      }, 1000);
    }
  });

  // Evento de mensajes
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      await procesarMensaje(msg);
    }
  });

  console.log('🚀 Baileys iniciado correctamente');
}

/**
 * Reinicia la conexión
 */
export async function restartBaileys({ delayMs = 3000 } = {}) {
  if (restarting) return;
  restarting = true;

  try {
    console.log('🔄 Reiniciando socket...');
    await hardCloseSocket();
    await wait(delayMs);
    await startBaileys();
  } finally {
    restarting = false;
  }
}

/**
 * Resetea la sesión completa
 */
export async function resetSession() {
  if (restarting) return;
  restarting = true;

  try {
    console.log('🗑️ Reseteando sesión...');
    lastQr = null;
    await hardCloseSocket();
    await wait(1500);
    await emptyDir(config.SESSIONS_DIR);
    await startBaileys();
    console.log('✅ Sesión reseteada');
  } finally {
    restarting = false;
  }
}
