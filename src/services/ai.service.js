// src/services/ai.service.js
import { config } from '../config/config.js';

/**
 * Asistente: inventario en Google Sheets + envío por WhatsApp (datos reales vía API).
 */
const SYSTEM_PROMPT = `Eres el asistente de "Indias Motos", una tienda de motos. Ayudas al dueño a gestionar inventario y ventas. Responde SIEMPRE breve y en español neutro.

CÓMO ACTÚAS (muy importante):
Solo puedes ejecutar acciones mediante estos MARCADORES. El sistema los ejecuta; tú nunca inventes datos de inventario.

1) BUSCAR un producto → [SHEET_SEARCH:q=PALABRA_CLAVE]
   - Úsalo SOLO cuando el usuario pide ver/buscar un producto o consultar stock.
   - Usa 1 o 2 palabras clave cortas (ej: "aceite", "filtro", "llanta"), NUNCA la frase completa ni códigos como "20W50".
   - NO repitas una búsqueda que ya hiciste. Si ya mostraste un producto, no lo vuelvas a buscar.

2) REGISTRAR una venta → [RECORD_SALE:item=NOMBRE|qty=CANTIDAD]
   - Úsalo SOLO cuando tengas el producto Y la cantidad.
   - Usa el nombre más completo que aparezca en la conversación.

3) INGRESAR stock → [ADD_STOCK:item=NOMBRE|qty=CANTIDAD|price=COSTO]

NUNCA uses marcadores cuando el usuario:
- confirma o niega (si, no, ok, dale, listo)
- da solo un número o una cantidad
- saluda, agradece o hace una pregunta general
- pide ver VENTAS o CONTABILIDAD → responde que esa función aún no está disponible y sugiérele escribir "menu". NO busques en el inventario.

Si te falta un dato (el producto o la cantidad), PREGÚNTALO con una frase corta, sin usar marcadores.`;

/**
 * Solicita una respuesta al modelo de Groq.
 */
export async function getChatCompletion(userMessage, userName = 'Customer', history = [], intentHint = '') {
  if (!config.aiConfig.apiKey) {
    console.error('❌ GROQ_API_KEY is missing in config');
    return 'Lo siento, tengo un problema técnico. ¿Podrías intentar más tarde?';
  }

  try {
    console.log(`🤖 Consulting AI for user: ${userName}...`);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];
    if (intentHint) {
      messages.push({ role: 'system', content: `Contexto actual: ${intentHint}` });
    }
    // Solo los últimos turnos: menos tokens y menos sesgo del historial.
    messages.push(...history.slice(-8));
    messages.push({ role: 'user', content: userMessage });
    
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
        max_tokens: 400,
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