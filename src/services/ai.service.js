// src/services/ai.service.js
import { config } from '../config/config.js';

/**
 * Prompt system for the real estate agent
 */
const SYSTEM_PROMPT = `Eres un vendedor inmobiliario profesional y amigable de una empresa de bienes raíces en Colombia. 
Tu nombre es ${config.botConfig.salesRep} y trabajas para "${config.botConfig.company}".

CARACTERÍSTICAS DE TU PERSONALIDAD:
- Profesional pero cercano y amigable.
- Experto en el mercado inmobiliario colombiano en: ${config.botConfig.locations.join(', ')}.
- Usas emojis ocasionalmente para ser más cercano 🏠.

TU OBJETIVO:
- Identificar qué busca el cliente (compra, venta, arriendo).
- Conocer su presupuesto y ciudad preferida.
- Mostrar propiedades disponibles con el marcador de búsqueda.
- Agendar citas o tours una vez confirmados.

🔍 BÚSQUEDA DE PROPIEDADES (MUY IMPORTANTE):
Cuando el cliente te dé tipo, ciudad y presupuesto, responde exactamente así:
"Perfecto, voy a buscar opciones para ti... [SEARCH_PROPERTIES:type=rent|city=Pereira|price=500000]"

- type: debe ser 'rent' (arriendo) o 'sale' (venta).
- city: nombre de la ciudad.
- price: número sin puntos ni comas.

🗓️ AGENDAMIENTO:
Solo cuando el cliente confirme explícitamente los datos (fecha, hora, lugar), responde:
"¡Excelente! Tu cita está confirmada. [APPOINTMENT_SCHEDULED]"

INSTRUCCIONES:
- Responde en español colombiano.
- Sé breve (máximo 3-4 líneas).
- NO inventes propiedades, usa los marcadores.
- No uses asteriscos para negritas.`;

/**
 * Request completion from OpenRouter
 */
export async function getChatCompletion(userMessage, userName = 'Customer', history = []) {
  if (!config.aiConfig.apiKey) {
    console.error('❌ OPENROUTER_API_KEY is missing in config');
    return 'Lo siento, tengo un problema técnico. ¿Podrías intentar más tarde?';
  }
  
  try {
    console.log(`🤖 Consulting AI for user: ${userName}...`);
    
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage }
    ];
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.aiConfig.apiKey}`,
        'X-Title': config.botConfig.company
      },
      body: JSON.stringify({
        model: config.aiConfig.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 450
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.error('❌ OpenRouter Error:', data.error);
      return 'Disculpa, mi cerebro digital se distrajo. ¿Me repites eso?';
    }

    return data.choices[0]?.message?.content || 'No pude procesar tu solicitud.';
    
  } catch (error) {
    console.error('❌ AI Service Exception:', error.message);
    return 'Tuve un error técnico, pero un asesor humano te contactará pronto. 🙏';
  }
}

/**
 * Extracts property search parameters from markers like [SEARCH_PROPERTIES:...]
 */
export function extractSearchParameters(response) {
  const regex = /\[SEARCH_PROPERTIES:([^\]]+)\]/;
  const match = response.match(regex);
  
  if (!match) return null;
  
  const params = {};
  match[1].split('|').forEach(param => {
    const [key, value] = param.split('=');
    if (key && value) params[key.trim()] = value.trim();
  });
  
  return params;
}