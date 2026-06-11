/**
 * Estado de autenticación de Baileys respaldado en PostgreSQL.
 *
 * Reemplaza a useMultiFileAuthState (disco efímero) para que la sesión de WhatsApp
 * sobreviva a reinicios, deploys y spin-down. Cada credencial/clave se guarda como una
 * fila en la tabla `whatsapp_auth (id TEXT PRIMARY KEY, data TEXT)`.
 *
 * Serializa con BufferJSON (replacer/reviver) porque las credenciales contienen Buffers
 * que JSON.stringify no maneja de forma nativa.
 */
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import { pool } from "./database.service.js";

const CREDS_ID = "creds";

async function readData(id) {
    const res = await pool.query("SELECT data FROM whatsapp_auth WHERE id = $1", [id]);
    if (res.rows.length === 0) return null;
    return JSON.parse(res.rows[0].data, BufferJSON.reviver);
}

async function writeData(id, value) {
    const data = JSON.stringify(value, BufferJSON.replacer);
    await pool.query(
        `INSERT INTO whatsapp_auth (id, data) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [id, data]
    );
}

async function removeData(id) {
    await pool.query("DELETE FROM whatsapp_auth WHERE id = $1", [id]);
}

/**
 * Devuelve { state, saveCreds } compatible con makeWASocket, leyendo y escribiendo
 * la sesión en Postgres. initDatabase() debe haberse ejecutado antes.
 */
export async function usePostgresAuthState() {
    const creds = (await readData(CREDS_ID)) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === "app-state-sync-key" && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(key, value) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: async () => {
            await writeData(CREDS_ID, creds);
        },
    };
}

/**
 * Borra TODA la sesión almacenada en Postgres (equivale a borrar la carpeta auth local).
 * Usado por resetSession() para forzar un nuevo escaneo de QR.
 */
export async function clearPostgresAuthState() {
    await pool.query("DELETE FROM whatsapp_auth");
}
