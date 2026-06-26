# WhatsApp Inventory Bot 🏍️📦

Bot de WhatsApp con IA para **gestión de inventario y ventas**, usando **Google Sheets** como base de datos. Pensado para pequeños negocios (el ejemplo configurado es *Indias Motos*, una tienda de motos y repuestos), pero reutilizable para cualquier inventario.

Desde WhatsApp, un empleado puede:

- 📦 **Ver inventario** por palabra clave (con foto, precio y stock) o pedir un **PDF completo**.
- ➕ **Ingresar stock** (producto existente → suma; producto nuevo → lo crea).
- 🧾 **Registrar ventas** a precio de venta, con confirmación y actualización automática del stock.
- 📊 **Informe contable** (quincena o mes) con márgenes de ganancia.

El bot guía estas operaciones **paso a paso desde un menú**; la IA (Groq) solo atiende saludos y preguntas generales.

---

## ✨ Características

- **WhatsApp sin API oficial** mediante [Baileys](https://github.com/WhiskeySockets/Baileys) (vinculación por QR).
- **Sesión persistida en PostgreSQL**: el bot reconecta tras reinicios/deploys **sin re-escanear el QR**.
- **IA conversacional** con [Groq](https://groq.com/) (`llama-3.3-70b`).
- **Google Sheets como backend** vía Apps Script (hojas `Inventario`, `Ventas`, `Contabilidad`).
- **Flujos por menú deterministas** (la IA no inventa productos ni precios).
- **Reportes PDF** del inventario generados al vuelo.
- **Panel web** para vincular el QR, ver `/health` y reiniciar la sesión, **protegido con Basic Auth**.
- **Listo para desplegar** en Render (`render.yaml` incluido).

> ⚠️ **Nota:** Baileys es una librería no oficial de WhatsApp. Úsala bajo tu responsabilidad y respeta los términos de servicio de WhatsApp.

---

## 🧩 Cómo funciona

```
┌──────────────┐   mensaje    ┌─────────────────┐   prompt    ┌──────────┐
│   WhatsApp   │ ───────────▶ │  Bot (Baileys)  │ ──────────▶ │ Groq IA  │
│  (empleado)  │ ◀─────────── │  + Express      │ ◀────────── │          │
└──────────────┘  respuesta   └───┬─────────┬───┘             └──────────┘
                                  │         │
              GET/POST inventario │         │ sesión de WhatsApp
                                  ▼         ▼
                    ┌───────────────────┐  ┌──────────────┐
                    │  Apps Script Web  │  │  PostgreSQL  │
                    │   App  ⇄  Sheets  │  │ whatsapp_auth│
                    └───────────────────┘  └──────────────┘
```

- **Google Sheets** guarda los datos de negocio (inventario, ventas, contabilidad).
- **PostgreSQL** guarda únicamente la sesión de WhatsApp (tabla `whatsapp_auth`), para no re-escanear el QR.

---

## 🛠️ Stack

- **Node.js** ≥ 18 (ESM, `"type": "module"`)
- **Express** — servidor web y panel
- **@whiskeysockets/baileys** — cliente de WhatsApp
- **Groq API** — inferencia de IA (formato compatible con OpenAI)
- **pg (PostgreSQL)** — persistencia de la sesión
- **Apps Script + Google Sheets** — datos de negocio
- **pdfkit-table** — reportes PDF

---

## 📁 Estructura

```
src/
├── server.js                       # Entrada: valida config → Postgres → Baileys + Express
├── app.js                          # Configuración de Express
├── config/config.js                # Lectura de variables de entorno
├── routes/web.routes.js            # Rutas: /  /health  /qr*  /reset*   (* = protegidas)
├── middlewares/admin.middleware.js # Basic Auth para /qr y /reset (ADMIN_TOKEN)
├── controllers/web.controller.js   # Panel, QR y health check
└── services/
    ├── baileys.service.js          # Conexión WhatsApp + flujos del menú
    ├── auth.service.js             # Estado de sesión Baileys respaldado en Postgres
    ├── database.service.js         # Pool de PostgreSQL + creación de tabla
    ├── ai.service.js               # Prompt y llamada a Groq
    ├── sheets.service.js           # Lectura/escritura en Google Sheets
    ├── conversation.service.js     # Historial y estado por usuario (en memoria)
    └── pdf.service.js              # Generación de PDF de inventario

scripts/
└── google-apps-script-*.gs         # Backend de Sheets (Apps Script)

render.yaml                         # Despliegue en Render
```

---

## 🚀 Puesta en marcha (local)

### 1. Requisitos
- Node.js 18 o superior
- Una base de datos **PostgreSQL** (local, o gratis en [Neon](https://neon.tech) / [Supabase](https://supabase.com))
- Una cuenta de Google (para la hoja de cálculo)
- Una API key de [Groq](https://console.groq.com/keys) (gratis)

### 2. Instalar
```bash
git clone https://github.com/quiroivan02-cyber/whatsapp-inventory-bot.git
cd whatsapp-inventory-bot
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env
```
Edita `.env` con tu `DATABASE_URL`, `GROQ_API_KEY`, `SHEETS_API_URL` y un `ADMIN_TOKEN`.

### 4. Configurar Google Sheets
1. Crea una hoja de cálculo con las pestañas **`Inventario`**, **`Ventas`** y **`Contabilidad`**.
   La hoja `Inventario` debe tener columnas tipo: `sku | nombre | stock | precio | foto`.
2. Abre **Extensiones → Apps Script** y pega el contenido de
   [`scripts/google-apps-script-indias-motos.gs`](scripts/google-apps-script-indias-motos.gs).
3. **Implementar → Nueva implementación → Aplicación web**, con acceso *"Cualquier usuario"*.
4. Copia la URL `/exec` y pégala en `SHEETS_API_URL` de tu `.env`.

### 5. Ejecutar
```bash
npm run dev    # con recarga automática
# o
npm start
```
Al arrancar se crea automáticamente la tabla `whatsapp_auth` en tu Postgres.

### 6. Vincular WhatsApp
1. Abre **http://localhost:3000** y pulsa **Escanear Código QR**.
2. El navegador pedirá usuario/contraseña (Basic Auth): usuario cualquiera, contraseña = tu `ADMIN_TOKEN`.
3. En WhatsApp → *Dispositivos vinculados → Vincular un dispositivo* y escanea el QR.
4. Cuando el panel diga **● DISPOSITIVO VINCULADO**, escríbele `menu` al bot.

---

## 💬 Uso (menú del bot)

Escribe `menu` en cualquier momento para ver las opciones:

| Opción | Acción |
| --- | --- |
| `1` | Ver inventario (palabra clave, o `todos` para PDF) |
| `2` | Ingresar inventario (suma a existentes o crea nuevo) |
| `3` | Registrar una venta |
| `4` | Informe contable (quincena o mes) |

---

## 🌐 Panel web

| Ruta | Método | Protegida | Descripción |
| --- | --- | --- | --- |
| `/` | GET | No | Panel de control (estado + accesos) |
| `/health` | GET | No | Estado en JSON (monitoreo / keep-alive) |
| `/qr` | GET | 🔒 Basic Auth | Muestra el QR para vincular |
| `/reset` | POST | 🔒 Basic Auth | Cierra sesión y borra la sesión de Baileys |

Las rutas protegidas usan `ADMIN_TOKEN` como contraseña. Si no está definido, devuelven `503` (fail-closed).

---

## ⚙️ Variables de entorno

| Variable | Requerida | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | **Sí** | Cadena de conexión PostgreSQL (persiste la sesión) |
| `SHEETS_API_URL` | **Sí** | URL `/exec` del Web App de Apps Script |
| `GROQ_API_KEY` | **Sí** | API key de Groq |
| `ADMIN_TOKEN` | Recomendada | Contraseña de `/qr` y `/reset` |
| `AI_MODEL` | No | Modelo de Groq (por defecto `llama-3.3-70b-versatile`) |
| `PORT` | No | Puerto del servidor (por defecto `3000`) |
| `NODE_ENV` | No | `development` / `production` |
| `BOT_COMPANY` | No | Nombre del negocio (panel y mensajes) |
| `BOT_SALES_REP` | No | Nombre del agente |

Ver [`.env.example`](.env.example) para la plantilla completa.

---

## ☁️ Despliegue (Render)

El repo incluye [`render.yaml`](render.yaml). Crea un *Web Service*, define las variables marcadas como secretas (`DATABASE_URL`, `GROQ_API_KEY`, `SHEETS_API_URL`, `ADMIN_TOKEN`) en el dashboard y despliega.

> ⚠️ En el **plan gratuito** Render suspende el contenedor sin tráfico HTTP; mientras duerme, el WebSocket de WhatsApp se cae y no atiende mensajes en tiempo real. Como la sesión vive en Postgres, al despertar reconecta sin re-escanear el QR, pero para **24/7 real** hace falta un plan *Always on* o un VPS. Un servicio externo que haga `GET /health` cada ~10–14 min mitiga (no elimina) el problema.

---

## 🧠 Personalizar para otro negocio

1. Cambia `BOT_COMPANY` / `BOT_SALES_REP` en `.env`.
2. Ajusta el menú y los textos en `src/services/baileys.service.js` (`MAIN_MENU`).
3. Ajusta el `SYSTEM_PROMPT` en `src/services/ai.service.js`.
4. Adapta las columnas y la lógica del Apps Script en `scripts/`.

---

## 📌 Notas y limitaciones

- El **historial y el estado** de cada conversación se guardan **en memoria**: se pierden al reiniciar el proceso (la sesión de WhatsApp, en cambio, sí persiste en Postgres).
- Baileys puede requerir re-vincular el QR si la sesión es invalidada desde el teléfono.

---

## 📄 Licencia

MIT
