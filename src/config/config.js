import dotenv from "dotenv";

dotenv.config();

export const config = {
  // Server Configuration
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

  // Database Configuration (PostgreSQL)
  databaseUrl: process.env.DATABASE_URL || "",

  // Google Sheets API Configuration (Apps Script URL)
  sheetsConfig: {
    apiUrl: process.env.SHEETS_API_URL || "",
  },

  // AI Configuration (Groq)
  aiConfig: {
    apiKey: process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || "",
    // Modelo predeterminado para Groq
    model:
      process.env.GROQ_MODEL ||
      process.env.AI_MODEL ||
      "llama-3.3-70b-versatile",
    httpReferer: process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
  },

  // Baileys: carpeta de sesión (en Render monta un disco persistente y apunta aquí, ej. /data/baileys-auth)
  baileysAuthDir: process.env.BAILEYS_AUTH_DIR || "auth_info_baileys",

  sessionsDir: process.env.SESSIONS_DIR || "./sessions",

  // Real Estate Bot Business Logic
  botConfig: {
    company: process.env.BOT_COMPANY || "Inmobiliaria Prime",
    salesRep: process.env.BOT_SALES_REP || "Sofia",
    locations: [
      "Bogotá",
      "Medellín",
      "Pereira",
      "Cali"
    ]
  }
};

/**
 * Validates that all critical environment variables are loaded.
 */
export function validateConfig() {
  const missingConfigs = [];

  if (!config.databaseUrl) {
    missingConfigs.push("DATABASE_URL");
  }

  if (!config.sheetsConfig.apiUrl) {
    missingConfigs.push("SHEETS_API_URL");
  }

  if (!config.aiConfig.apiKey) {
    missingConfigs.push("GROQ_API_KEY"); 
  }

  if (missingConfigs.length > 0) {
    console.warn("❌ Critical configuration missing:");
    missingConfigs.forEach((key) => console.warn(`   - ${key}`));
    return false;
  }

  console.log("✅ Configuration loaded successfully.");
  return true;
}