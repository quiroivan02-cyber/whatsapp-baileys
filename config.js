// ========================================
// CONFIGURACIÓN Y VARIABLES DE ENTORNO
// ========================================

export const config = {
  // Puerto del servidor
  PORT: process.env.PORT || 3000,
  
  // Entorno
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // API de Google Sheets
  GOOGLE_SHEET_API: process.env.GOOGLE_SHEET_API || '',
  
  // API de Groq
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_MODEL: 'llama-3.3-70b-versatile',
  
  // Directorio de sesiones
  SESSIONS_DIR: '/app/sessions',
  
  // Configuración del bot
  BOT_CONFIG: {
    empresa: 'Inmobiliaria Prime',
    vendedor: 'Sofía',
    ubicaciones: ['Norte de Bogotá', 'Poblado (Medellín)', 'Pereira', 'Cali'],
  }
};

// Validar configuración requerida
export function validarConfig() {
  const errores = [];
  
  if (!config.GOOGLE_SHEET_API) {
    errores.push('⚠️ GOOGLE_SHEET_API no configurada');
  }
  
  if (!config.GROQ_API_KEY) {
    errores.push('⚠️ GROQ_API_KEY no configurada');
  }
  
  if (errores.length > 0) {
    console.warn('Advertencias de configuración:');
    errores.forEach(e => console.warn(e));
  }
  
  return errores.length === 0;
}
