import dotenv from "dotenv";

dotenv.config();

export const config = {
  // Server Configuration
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

  // Database Configuration (PostgreSQL)
  databaseUrl: process.env.DATABASE_URL || "",

  // Token para proteger rutas sensibles del panel (/qr, /reset) vía Basic Auth
  adminToken: process.env.ADMIN_TOKEN || "",

  // Google Sheets API Configuration (Apps Script URL)
  sheetsConfig: {
    apiUrl: process.env.SHEETS_API_URL || "",
  },

  // AI Configuration (Groq)
  aiConfig: {
    apiKey: process.env.GROQ_API_KEY || "",
    // Modelo predeterminado para Groq
    model:
      process.env.GROQ_MODEL ||
      process.env.AI_MODEL ||
      "llama-3.3-70b-versatile",
  },

  // Identidad del negocio
  botConfig: {
    company: process.env.BOT_COMPANY || "Indias Motos",
    salesRep: process.env.BOT_SALES_REP || "Asistente",
  },
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

  if (!config.adminToken) {
    console.warn("⚠️  ADMIN_TOKEN no configurado: /qr y /reset quedarán bloqueados hasta definirlo.");
  }

  if (missingConfigs.length > 0) {
    console.warn("❌ Critical configuration missing:");
    missingConfigs.forEach((key) => console.warn(`   - ${key}`));
    return false;
  }

  console.log("✅ Configuration loaded successfully.");
  return true;
}
