// ========================================
// INTEGRACIÓN CON GROQ AI
// ========================================

import { config } from './config.js';

/**
 * Sistema de prompt para el vendedor inmobiliario
 */
const SYSTEM_PROMPT = `Eres un vendedor inmobiliario profesional y amigable de una empresa de bienes raíces en Colombia. 

Tu nombre es ${config.BOT_CONFIG.vendedor} y trabajas para "${config.BOT_CONFIG.empresa}".

CARACTERÍSTICAS DE TU PERSONALIDAD:
- Profesional pero cercano y amigable
- Empático y atento a las necesidades del cliente
- Proactivo en ofrecer soluciones
- Experto en el mercado inmobiliario colombiano
- Usas emojis ocasionalmente para ser más cercano 🏠

INFORMACIÓN QUE MANEJAS:
- Apartamentos desde $200 millones hasta $800 millones
- Casas desde $300 millones hasta $1.500 millones
- Zonas: ${config.BOT_CONFIG.ubicaciones.join(', ')}
- Opciones de financiación disponibles
- Tours virtuales y presenciales

TU OBJETIVO:
- Identificar qué busca el cliente (compra, venta, arriendo)
- Conocer su presupuesto y preferencias
- Agendar una cita o tour
- Guardar sus datos de contacto

INSTRUCCIONES:
- Responde en español colombiano
- Sé breve (máximo 3-4 líneas por mensaje)
- Haz preguntas específicas para entender mejor al cliente
- Si el cliente pregunta por una propiedad específica, pide más detalles
- Siempre ofrece agendar una llamada o reunión
- No inventes precios o propiedades que no existen
- Si no sabes algo, di que consultarás con tu equipo

IMPORTANTE: No uses asteriscos para negritas. Usa emojis naturalmente.

CUANDO AGENDES UNA CITA O LLAMADA:
- Al final de tu mensaje, agrega: [CITA_AGENDADA]
- Esto ayuda al sistema a registrar la cita automáticamente

Ejemplo: "Perfecto San, mañana a las 10am te llamo para el tour virtual. ¡Que tengas excelente día! [CITA_AGENDADA]"
`;


/**
 * Consulta a Groq AI con contexto de vendedor inmobiliario
 * @param {string} mensajeUsuario - Mensaje del usuario
 * @param {string} nombreUsuario - Nombre del usuario
 * @param {Array} historial - Historial de conversación
 * @returns {Promise<string>} Respuesta generada
 */
export async function consultarGroq(mensajeUsuario, nombreUsuario = 'Cliente', historial = []) {
  if (!config.GROQ_API_KEY) {
    console.log('⚠️ GROQ_API_KEY no configurada');
    return 'Disculpa, estoy teniendo problemas técnicos. ¿Podrías intentar más tarde?';
  }
  
  try {
    console.log('🤖 Consultando Groq AI con historial...');
    
    // Construir mensajes con historial
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      ...historial, // ← Incluir historial de conversación
    ];
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: config.GROQ_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 300,
        top_p: 1,
        stream: false
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Error de Groq:', response.status, errorData);
      return 'Disculpa, estoy teniendo problemas para responder. Un asesor te contactará pronto. 😊';
    }
    
    const data = await response.json();
    const respuesta = data.choices[0]?.message?.content || 'No pude generar una respuesta.';
    
    console.log('✅ Respuesta de Groq recibida');
    return respuesta;
    
  } catch (error) {
    console.error('❌ Error en Groq AI:', error.message);
    return 'Disculpa, estoy teniendo un problema técnico. ¿Podrías escribirme en unos minutos? 🙏';
  }
}


/**
 * Detecta el tipo de solicitud basado en palabras clave
 * @param {string} texto - Texto del mensaje
 * @returns {string} Tipo de solicitud
 */
export function detectarTipoSolicitud(texto) {
  const textoLower = texto.toLowerCase();
  
  if (textoLower.includes('comprar') || textoLower.includes('compra')) {
    return 'Compra';
  }
  
  if (textoLower.includes('vender') || textoLower.includes('venta')) {
    return 'Venta';
  }
  
  if (textoLower.includes('arrendar') || textoLower.includes('arriendo') || 
      textoLower.includes('alquilar')) {
    return 'Arriendo';
  }
  
  if (textoLower.includes('precio') || textoLower.includes('cuanto') || 
      textoLower.includes('costo')) {
    return 'Consulta de precio';
  }
  
  if (textoLower.includes('ubicación') || textoLower.includes('zona') || 
      textoLower.includes('donde')) {
    return 'Consulta de ubicación';
  }
  
  return 'Consulta general';
}

