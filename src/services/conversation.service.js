/**
 * Historial por conversación de WhatsApp (clave = JID).
 * En memoria: se pierde al reiniciar el proceso (en servidor, aceptable; opcional: Redis después).
 */

const store = new Map();
/** Estado de la conversación por JID (ej: 'MAIN_MENU', 'AWAITING_SALE') */
const states = new Map();
/** Datos temporales para confirmaciones (ej: venta pendiente) */
const tempBuffer = new Map();

/** Máximo de mensajes guardados (user + assistant alternados). */
const MAX_MESSAGES = 24;

export function getHistoryForJid(jid) {
    if (!jid) return [];
    return store.get(jid) ? [...store.get(jid)] : [];
}

export function getStateForJid(jid) {
    return states.get(jid) || "IDLE";
}

export function setStateForJid(jid, state) {
    if (jid) states.set(jid, state);
}

export function setTempBufferForJid(jid, data) {
    if (jid) tempBuffer.set(jid, data);
}

export function getTempBufferForJid(jid) {
    return tempBuffer.get(jid) || null;
}

export function clearTempBufferForJid(jid) {
    tempBuffer.delete(jid);
}

/**
 * @param {string} jid
 * @param {string} userText - mensaje del cliente
 * @param {string} assistantText - respuesta enviada (sin marcadores técnicos)
 */
export function appendTurn(jid, userText, assistantText) {
    if (!jid) return;
    const list = store.get(jid) || [];
    list.push({ role: "user", content: userText });
    list.push({
        role: "assistant",
        content: assistantText || "…",
    });
    while (list.length > MAX_MESSAGES) {
        list.shift();
    }
    store.set(jid, list);
}

export function clearHistoryForJid(jid) {
    if (!jid) return;
    store.delete(jid);
}
