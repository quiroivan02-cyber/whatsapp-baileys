import pkg from 'pg';
const { Pool } = pkg;
import { config } from "../config/config.js";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' 
    ? { rejectUnauthorized: false } 
    : false
});

export const initDatabase = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS whatsapp_auth (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
    );
  `;
  try {
    await pool.query(queryText);
    console.log("🐘 Postgres: Tabla whatsapp_auth lista.");
  } catch (err) {
    console.error("❌ Error inicializando la base de datos:", err);
    throw err;
  }
};