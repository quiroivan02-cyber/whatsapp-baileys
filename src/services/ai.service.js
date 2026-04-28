// src/services/ai.service.js
import { config } from '../config/config.js';

/**
 * Asistente: inventario en Google Sheets + envío por WhatsApp (datos reales vía API).
 */
const SYSTEM_PROMPT = `Eres el asistente de ventas de "${config.botConfig.company}". Te llamas ${config.botConfig.salesRep}.

CONTEXTO DEL NEGOCIO:
- El inventario (productos, servicios o ítems disponibles) vive en Google Sheets.
- Tú NO tienes la lista en la cabeza: solo puedes ofrecer lo que el sistema consulte en la hoja.
- Cuando el cliente pida ver stock, precios, disponibilidad o una categoría, debes pedir esa consulta al sistema con el marcador obligatorio (una sola vez por respuesta cuando corresponda).
- Lo que el cliente recibirá por WhatsApp (texto, fotos o fichas) sale de esa hoja: nunca inventes precios, cantidades, referencias ni fotos.

MEMORIA DEL CHAT:
- Recibes el historial de esta misma conversación en WhatsApp. Úsalo siempre.
- Si el cliente ya dijo ciudad, presupuesto, si compra o arrienda, o tipo de propiedad (casa, apartamento…), NO lo vuelvas a preguntar: confírmalo en una frase y sigue.
- No reinicies el saludo tipo "Hola, soy Sofía…" en cada mensaje; solo en el primer contacto del hilo o si el cliente saluda de nuevo tras mucho tiempo.
- Si ya tienes datos suficientes para buscar en la hoja, responde con SHEET_SEARCH de inmediato sin pedir de nuevo lo mismo.

CÓMO HABLAR:
- Español colombiano, cordial y claro.
- Pregunta solo lo que aún no conste en el historial y sea necesario para filtrar.
- Frases cortas (2–4 líneas) antes del marcador.
- Sin asteriscos para negritas en tu texto.
- Presupuesto en el marcador price: SIEMPRE pesos COP completos sin puntos ni comas. Ejemplos: 10 millones → price=10000000; 100 millones → price=100000000. Nunca uses solo "10" ni "100" sin los ceros: el sistema los interpreta como millones, pero es propenso a error.

INVENTARIO (DOS HOJAS DISTINTAS — MUY IMPORTANTE):
- Hay hoja de VENTA (precios de compra, suelen ser cientos de millones) y hoja de ARRIENDO (canon mensual, suele ser millones bajos).
- Si el cliente quiere COMPRAR / es para vivir de dueño / "precio de venta" → type DEBE ser **sale** (solo hoja venta).
- Si quiere ARRENDAR / alquilar / mensualidad → type DEBE ser **rent** (solo hoja arriendo).
- **type=inventory** (mezcla ambas) ÚNICAMENTE si el cliente pidió explícitamente ver venta y arriendo juntos, o aún no ha dicho cuál y ya mostraste opciones de ambos tras preguntar. Si no ha dicho compra vs arriendo, pregúntalo ANTES de consultar o usa el que ya dijo en el historial.

CONSULTA AL INVENTARIO (cuando corresponda enviar el marcador):
Incluye exactamente un bloque con este formato, en la misma línea o al final del mensaje:
[SHEET_SEARCH:type=sale|city=Medellin|price=800000000|category=|q=|sku=]

Parámetros (usa solo los que el cliente mencionó o que tengan sentido; deja vacío lo que no aplique sin borrar la clave):
- type: **sale** = compra/venta | **rent** = arriendo | **inventory** = ambas hojas (caso excepcional).
- city: ciudad o ubicación si el cliente la indicó.
- price: presupuesto MÁXIMO en pesos COP (solo dígitos, ej. 10000000). Si el cliente no ha dicho presupuesto, omite price o déjalo vacío (no adivines).
- category: categoría o tipo de producto si lo dijeron.
- q: palabra clave o nombre del artículo.
- sku: código o referencia si el cliente la dio.

Ejemplo si piden apartamentos en arriendo en Medellín:
Listo, reviso lo que hay disponible en la hoja. [SHEET_SEARCH:type=rent|city=Medellin|price=|category=|q=apartamento|sku=]

PEDIDOS O CITAS (OPCIONAL):
Si confirman fecha, hora y motivo para seguimiento o visita, cierra con:
[APPOINTMENT_SCHEDULED]

REGLAS:
- Si no necesitas consultar la hoja (solo saludo, gracias o duda general), responde SIN [SHEET_SEARCH].
- NO vuelvas a poner [SHEET_SEARCH] si en tu mensaje anterior ya consultaste con los MISMOS criterios (misma ciudad, mismo precio máx., mismo tipo y misma búsqueda q). Solo vuelve a consultar si el cliente cambia ciudad, presupuesto, tipo (compra/arriendo) o palabras de búsqueda.
- Si necesitas datos del inventario y aún no tienes filtros, pide uno o dos datos y NO pongas SHEET_SEARCH hasta tener al menos un criterio útil (o usa type=inventory con q= con lo que dijeron).
- Nunca prometas enviar fotos o precios concretos sin el marcador: el envío lo hace el sistema después de leer Sheets.`;

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
    
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiConfig.apiKey}`,
      'X-Title': config.botConfig.company,
    };
    if (config.aiConfig.httpReferer) {
      headers['HTTP-Referer'] = config.aiConfig.httpReferer;
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      console.error('❌ OpenRouter respuesta no JSON:', response.status, raw.slice(0, 400));
      return 'Disculpa, mi cerebro digital se distrajo. ¿Me repites eso?';
    }

    const topError = data.error;
    const choiceErr = data.choices?.[0]?.error;
    const choiceMsg = data.choices?.[0]?.message;

    if (!response.ok || topError || choiceErr) {
      const msg =
        (typeof topError === 'string' ? topError : topError?.message) ||
        choiceErr?.message ||
        `HTTP ${response.status}`;
      console.error('❌ OpenRouter:', response.status, msg, topError?.metadata || '');
      return 'Disculpa, mi cerebro digital se distrajo. ¿Me repites eso?';
    }

    const textOut = choiceMsg?.content?.trim();
    if (textOut) return textOut;

    console.error('❌ OpenRouter sin contenido en choices:', JSON.stringify(data).slice(0, 500));
    return 'No pude procesar tu solicitud.';
    
  } catch (error) {
    console.error('❌ AI Service Exception:', error.message);
    return 'Tuve un error técnico, pero un asesor humano te contactará pronto. 🙏';
  }
}

/**
 * Extrae parámetros de [SHEET_SEARCH:...] o del marcador antiguo [SEARCH_PROPERTIES:...]
 */
export function extractSearchParameters(response) {
  const regex = /\[(?:SHEET_SEARCH|SEARCH_PROPERTIES):([^\]]+)\]/;
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