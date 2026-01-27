# ============================================
# Fase 1: Builder - Instalar dependencias
# ============================================
FROM node:20-alpine AS builder

# Instalar FFmpeg
RUN apk add --no-cache ffmpeg

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# ============================================
# Fase 2: Producción - Imagen final
# ============================================
FROM node:20-alpine

# Instalar FFmpeg en la imagen final y configuraciones iniciales
RUN apk add --no-cache ffmpeg && \
    # Crear usuario no-root para seguridad
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    # Crear directorios necesarios
    mkdir -p /app/uploads /app/outputs && \
    chown -R nodejs:nodejs /app

# Establecer directorio de trabajo
WORKDIR /app

# Copiar dependencias desde builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copiar código de la aplicación
COPY --chown=nodejs:nodejs server.js ./
COPY --chown=nodejs:nodejs compatibilidad.js ./
COPY --chown=nodejs:nodejs package*.json ./

# Cambiar a usuario no-root
USER nodejs

# Exponer puerto
EXPOSE 3000

# Variables de entorno por defecto
ENV NODE_ENV=production \
    PORT=3000

# Healthcheck para Docker
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Comando de inicio
CMD ["node", "server.js"]

