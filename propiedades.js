// ========================================
// CONSULTA DE PROPIEDADES DESDE GOOGLE SHEETS
// ========================================

import { config } from './config.js';

/**
 * Obtiene propiedades de arriendo desde Google Sheets
 * @param {string} ciudad - Ciudad para filtrar (opcional)
 * @param {number} precioMax - Precio máximo (opcional)
 * @returns {Promise<Object>} Lista de propiedades
 */
export async function obtenerPropiedadesArriendo(ciudad = '', precioMax = null) {
  if (!config.GOOGLE_SHEET_API) {
    console.log('⚠️ GOOGLE_SHEET_API no configurada');
    return { success: false, propiedades: [] };
  }
  
  try {
    console.log('🏠 Consultando propiedades de arriendo...');
    
    // Construir URL con parámetros
    let url = `${config.GOOGLE_SHEET_API}?action=getArriendo`;
    if (ciudad) url += `&ciudad=${encodeURIComponent(ciudad)}`;
    if (precioMax) url += `&precioMax=${precioMax}`;
    
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();
    
    if (data.success) {
      console.log(`✅ ${data.total} propiedades de arriendo encontradas`);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error al consultar arriendo:', error.message);
    return { success: false, propiedades: [] };
  }
}

/**
 * Obtiene propiedades de venta desde Google Sheets
 */
export async function obtenerPropiedadesVenta(ciudad = '', precioMax = null) {
  if (!config.GOOGLE_SHEET_API) {
    console.log('⚠️ GOOGLE_SHEET_API no configurada');
    return { success: false, propiedades: [] };
  }
  
  try {
    console.log('🏠 Consultando propiedades de venta...');
    
    let url = `${config.GOOGLE_SHEET_API}?action=getVenta`;
    if (ciudad) url += `&ciudad=${encodeURIComponent(ciudad)}`;
    if (precioMax) url += `&precioMax=${precioMax}`;
    
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();
    
    if (data.success) {
      console.log(`✅ ${data.total} propiedades de venta encontradas`);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error al consultar venta:', error.message);
    return { success: false, propiedades: [] };
  }
}

/**
 * Formatea propiedades para enviar por WhatsApp
 */
export function formatearPropiedades(propiedades, limite = 5) {
  if (!propiedades || propiedades.length === 0) {
    return 'No encontré propiedades con esos criterios. ¿Quieres que busque en otra ciudad o con otro presupuesto?';
  }
  
  let mensaje = `📋 Encontré ${propiedades.length} propiedad(es):\n\n`;
  
  // Mostrar solo las primeras 'limite' propiedades
  const propiedadesMostrar = propiedades.slice(0, limite);
  
  propiedadesMostrar.forEach((prop, index) => {
    const precioFormateado = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(prop.precio);
    
    mensaje += `${index + 1}. 📍 ${prop.ciudad}\n`;
    mensaje += `   🏠 ${prop.direccion}\n`;
    mensaje += `   💰 ${precioFormateado}\n\n`;
  });
  
  if (propiedades.length > limite) {
    mensaje += `\n... y ${propiedades.length - limite} más. ¿Te interesa alguna?`;
  } else {
    mensaje += `\n¿Te interesa alguna de estas propiedades?`;
  }
  
  return mensaje;
}
