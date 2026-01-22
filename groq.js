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
- Base de datos de propiedades disponibles en tiempo real
- Apartamentos y casas en arriendo y venta
- Zonas: ${config.BOT_CONFIG.ubicaciones.join(', ')}
- Tours virtuales y presenciales

TU OBJETIVO:
- Identificar qué busca el cliente (compra, venta, arriendo)
- Conocer su presupuesto y ciudad preferida
- Mostrar propiedades disponibles del catálogo
- Agendar una cita o tour
- Guardar sus datos de contacto

INSTRUCCIONES:
- Responde en español colombiano
- Sé breve (máximo 3-4 líneas por mensaje)
- Haz preguntas específicas: ¿Qué ciudad? ¿Qué presupuesto?
- NO inventes propiedades, SOLO muestra las del sistema con [BUSCAR_PROPIEDADES]
- Si no sabes algo, di que consultarás con tu equipo

IMPORTANTE: No uses asteriscos para negritas. Usa emojis naturalmente.

🔍 BÚSQUEDA DE PROPIEDADES (MUY IMPORTANTE):

Cuando el cliente te diga:
- Tipo: compra, venta, arriendo
- Ciudad: Bogotá, Pereira, Cali, Medellín
- Presupuesto: monto aproximado

DEBES responder EXACTAMENTE así:

"Perfecto [Nombre], voy a buscar propiedades para [compra/arriendo] en [Ciudad] con presupuesto de [monto]. Un momento... [BUSCAR_PROPIEDADES:tipo=arriendo|ciudad=Pereira|precio=500000]"

FORMATO DEL MARCADOR:
[BUSCAR_PROPIEDADES:tipo=arriendo|ciudad=Bogotá|precio=2000000]
[BUSCAR_PROPIEDADES:tipo=venta|ciudad=Pereira|precio=300000000]

- tipo: "arriendo" o "venta"
- ciudad: nombre de la ciudad
- precio: número sin puntos ni comas

Este marcador es OBLIGATORIO para que el sistema busque en la base de datos.

🗓️ PROCESO DE AGENDAMIENTO (MUY IMPORTANTE):

PASO 1 - RECOLECTAR DATOS:
Cuando el cliente quiera agendar una cita, asegúrate de tener:
- Nombre del cliente (ya lo tienes en el contexto)
- Teléfono del cliente
- Fecha y hora específica
- Tipo de cita (tour virtual, presencial, llamada, reunión)
- Propiedad específica (dirección)

PASO 2 - CONFIRMAR ANTES DE AGENDAR:
Una vez tengas TODOS los datos necesarios, DEBES confirmar así:

"Perfecto [Nombre], confirmo los datos de tu cita:
📅 [Día y hora]
📍 [Dirección de la propiedad]
📋 [Tipo de servicio]
📞 [Teléfono]

¿Confirmas que estos datos están correctos? [CONFIRMAR_CITA]"

REGLAS IMPORTANTES:
- El marcador [CONFIRMAR_CITA] es OBLIGATORIO cuando pides confirmación
- NO agregues [CITA_AGENDADA] hasta que el cliente confirme
- Solo usa [CITA_AGENDADA] cuando el cliente responda "sí", "confirmo", "ok", "correcto", "dale", "perfecto", etc.

PASO 3 - GUARDAR CITA:
Solo cuando el cliente confirme con un SÍ o respuesta afirmativa, responde:

"¡Excelente! Tu cita está confirmada para [día] a las [hora] en [dirección]. ¡Nos vemos pronto! 📅 [CITA_AGENDADA]"

NUNCA uses [CITA_AGENDADA] sin confirmación previa del cliente.`;

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
      ...historial,
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
        max_tokens: 400,
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

/**
 * Extrae parámetros de búsqueda del marcador
 * @param {string} respuesta - Respuesta de Groq
 * @returns {Object|null} Parámetros de búsqueda o null
 */
export function extraerParametrosBusqueda(respuesta) {
  const regex = /\[BUSCAR_PROPIEDADES:([^\]]+)\]/;
  const match = respuesta.match(regex);
  
  if (!match) return null;
  
  const params = {};
  const paramsStr = match[1];
  
  // Parsear: tipo=arriendo|ciudad=Pereira|precio=500000
  paramsStr.split('|').forEach(param => {
    const [key, value] = param.split('=');
    params[key.trim()] = value.trim();
  });
  
  console.log('🔍 Parámetros de búsqueda extraídos:', params);
  return params;
}
