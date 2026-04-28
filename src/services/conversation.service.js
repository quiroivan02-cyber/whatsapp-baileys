/**
 * Historial por conversación de WhatsApp (clave = JID).
 * En memoria: se pierde al reiniciar el proceso (en servidor, aceptable; opcional: Redis después).
 */

const store = new Map();
/** Última consulta a Sheets por JID (evita reenviar las mismas fichas). */
const lastSheetQueryKey = new Map();

/** Máximo de mensajes guardados (user + assistant alternados). */
const MAX_MESSAGES = 24;

export function getHistoryForJid(jid) {
    if (!jid) return [];
    return store.get(jid) ? [...store.get(jid)] : [];
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

export function getLastSheetQueryKey(jid) {
    if (!jid) return null;
    return lastSheetQueryKey.get(jid) ?? null;
}

export function setLastSheetQueryKey(jid, key) {
    if (jid && key) lastSheetQueryKey.set(jid, key);
}

export function clearHistoryForJid(jid) {
    if (!jid) return;
    store.delete(jid);
    lastSheetQueryKey.delete(jid);
}
