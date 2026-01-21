FROM node:20-alpine

# Instalar git (requerido por @whiskeysockets/baileys)
RUN apk add --no-cache git

WORKDIR /app

# Copiar package.json
COPY package.json ./

# Instalar dependencias
RUN npm install --production

# Copiar el resto del código
COPY . .

# Exponer puerto
EXPOSE 8000

# Comando de inicio
CMD ["node", "index.js"]
