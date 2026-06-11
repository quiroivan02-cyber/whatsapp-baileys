// src/services/ai.service.js
import { config } from '../config/config.js';

/**
 * Asistente: inventario en Google Sheets + envío por WhatsApp (datos reales vía API).
 */
const SYSTEM_PROMPT = `Eres el asistente de "Indias motos". Gestionas inventario de motocicletas y repuestos.

REGLAS DE ORO (Ahorro de tokens):
1. Si el usuario elige una opción del menú, NO uses la IA para responder "entendido", hazlo tú directamente en el código si puedes, pero si llegas aquí, ve al grano.
2. Para VENTAS: Extrae el NOMBRE exacto del producto. Si el usuario dice "20W50", busca "Aceite" o el nombre completo que aparezca en el historial.
3. Si el usuario confirma con "si", "no", "confirmar", NO generes marcadores, solo responde cordialmente.

MARCADORES:
- [SHEET_SEARCH:q=palabra_clave] (Usa palabras clave, ej: "aceite" en lugar de "20W50")
- [RECORD_SALE:item=Nombre Completo|qty=1] (Usa el nombre lo más completo posible para que coincida en la hoja)
- [ADD_STOCK:item=Nombre|qty=1|price=0]

CONSEJO: Sé breve. Español colombiano.`;

/**
 * Solicita una respuesta al modelo de Groq.
 */
export async function getChatCompletion(userMessage, userName = 'Customer', history = []) {
  if (!config.aiConfig.apiKey) {
    console.error('❌ GROQ_API_KEY is missing in config');
    return 'Lo siento, tengo un problema técnico. ¿Podrías intentar más tarde?';
  }
  
  try {
    console.log(`🤖 Consulting AI for user: ${userName}...`);
    
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage }
    ];
    
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiConfig.apiKey}`,
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.aiConfig.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 550,
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('❌ Groq respuesta no JSON:', response.status, raw.slice(0, 400));
      return 'Disculpa, mi cerebro digital se distrajo. ¿Me repites eso?';
    }

    const topError = data.error;
    const choiceMsg = data.choices?.[0]?.message;

    if (!response.ok || topError) {
      const msg =
        (typeof topError === 'string' ? topError : topError?.message) ||
        `HTTP ${response.status}`;
      console.error('❌ Groq:', response.status, msg);
      return 'Disculpa, mi cerebro digital se distrajo. ¿Me repites eso?';
    }

    const textOut = choiceMsg?.content?.trim();
    if (textOut) return textOut;

    console.error('❌ Groq sin contenido en choices:', JSON.stringify(data).slice(0, 500));
    return 'No pude procesar tu solicitud.';
    
  } catch (error) {
    console.error('❌ AI Service Exception:', error.message);
    return 'Tuve un error técnico, pero un asesor humano te contactará pronto. 🙏';
  }
}

/**
 * Extrae parámetros de marcadores técnicos
 */
export function extractActionParameters(response, tag) {
  const regex = new RegExp(`\\[${tag}:([^\\]]+)\\]`);
  const match = response.match(regex);

  if (!match) return null;

  const params = {};
  match[1].split("|").forEach((param) => {
    const eq = param.indexOf("=");
    if (eq === -1) return;
    const key = param.slice(0, eq).trim();
    const value = param.slice(eq + 1).trim();
    if (key) params[key] = value;
  });

  return params;
}

export function extractSearchParameters(response) {
    return extractActionParameters(response, "SHEET_SEARCH");
}