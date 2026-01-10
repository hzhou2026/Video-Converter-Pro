# 🎬 Video Converter Pro

Sistema avanzado de conversión de video con interfaz web, desarrollado como Trabajo Final de Grado.

## Características

- Subida de archivos mediante drag & drop
- Múltiples presets de conversión (H.264, H.265, AV1, VP9, ProRes, etc.)
- Opciones avanzadas de personalización
- Monitoreo en tiempo real con WebSockets
- Cola de trabajos con Redis
- Completamente dockerizado
- Interfaz responsive y moderna

## 🐳Inicio Rápido con Docker

### Requisitos Previos

- Docker 20.10+
- Docker Compose 2.0+
- 4GB RAM mínimo
- 10GB espacio en disco

### Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/hzhou2026/Video-Converter-Pro.git
cd Video-Converter-Pro

# 2. Copiar archivo de configuración
cp .env.example .env
# Edita .env y cambia los valores necesarios

# 3. Iniciar con Docker
docker compose up -d --build

# 4. Acceder a la aplicación
# Frontend: http://localhost
# Backend API: http://localhost:3000
```

### Comandos Útiles

```bash
# Ver logs en tiempo real
docker compose logs -f

# Detener servicios
docker compose down

# Reiniciar servicios
docker compose restart

# Ver estado
docker compose ps

# Esto borra TODO ¡Cuidado!
docker compose down -v
docker system prune -af
docker volume prune -f
```

## Desarrollo Local (sin Docker)

### Backend

```bash
# Instalar dependencias
npm install

# Iniciar Redis (necesario)
# En otra terminal:
redis-server

# Iniciar servidor
node server.js
```

### Frontend

```bash
cd tfg-frontend

# Instalar dependencias
npm install

# Iniciar en desarrollo
npm run dev
```

## Tecnologías

### Backend
- Node.js + Express
- FFmpeg
- Bull + Redis
- Socket.IO

### Frontend
- React 19
- Vite
- Socket.IO Client
- CSS

### Infraestructura
- Docker + Docker Compose
- Nginx como reverse proxy
- Redis para colas y caché

## Presets Disponibles

### Calidad (H.264 / H.265)
- **H.264 Ultra** (`h264-ultra`): CRF 15 · Máxima calidad  
- **H.264 High** (`h264-high`): CRF 18 · Alta calidad  
- **H.264 Balanced** (`h264-normal`): CRF 23 · Equilibrado  
- **H.264 Fast** (`h264-fast`): CRF 28 · Rápido  
- **H.265 High** (`h265-high`): Alta eficiencia  
- **H.265 Balanced** (`h265-normal`): Mejor compresión que H.264

### Códecs Modernos
- **AV1**: `av1-high`, `av1-normal`
- **VP9**: `vp9-web`, `webm-vp9`
- **VP8**: `webm-vp8-fast`

### Streaming y Web
- **Web Streaming**: `web-streaming`
- **Mobile Optimized**: `mobile-optimized`

### Redes Sociales
- **YouTube**: `youtube-4k`, `youtube-1080p`
- **Instagram**: `instagram-post`, `instagram-reel`
- **TikTok**: `tiktok-video`
- **Twitter / X**: `twitter-video`

### Profesionales
- **ProRes (MOV)**: `prores-proxy`, `prores-lt`, `prores-standard`, `prores-hq`
- **AVI Lossless**: `avi-ffv1-lossless`, `avi-huffyuv-lossless`, `avi-utvideo-lossless`
- **MJPEG**: `avi-mjpeg-high`, `avi-mjpeg-normal`
- **DV**: `avi-dv-pal`, `avi-dv-ntsc`

## Arquitectura

```
1. INTERACCIÓN DEL USUARIO
   ┌───────────────────────────────────┐
   │        CLIENTE (Navegador)        │
   │  (React App ejecutándose en PC)   │
   └────────────────┬──────────────────┘
                    │ ▲
   [HTTP Request]   │ │  [WebSocket Events]
   (Subir archivo,  │ │  (Progreso %, Estado,
    Cancelar job)   │ │   Error, Completado)
                    ▼ │
   ┌────────────────┴──────────────────┐
   │      SERVIDOR WEB / PROXY         │ ◄─── En Docker: Nginx
   │      (Frontend Entrypoint)        │ ◄─── Sin Docker: Vite / Localhost
   └────────────────┬──────────────────┘
                    │ ▲
                    │ │ 2. CANAL DE DATOS
      (Proxy Pass)  │ │ (Comunicación Bidireccional)
                    ▼ │
   ┌────────────────┴──────────────────┐
   │        SERVICIO BACKEND           │ ◄─── Node.js (Express + Socket.IO)
   │     (Gestor de Conversiones)      │
   └──────┬─────────┬────────▲─────────┘
          │         │        │
          │         │ 3. COLA DE ESTADO
 4. I/O   │         │ (Pub/Sub)
ARCHIVOS  │         ▼        │
          │      ┌───────────┴─────────┐
          │      │   SERVICIO REDIS    │ ◄─── Base de datos en memoria
          │      │ (Cola Bull/Eventos) │
          │      └─────────────────────┘
          │
          │ 5. PROCESAMIENTO
          ▼
   ┌──────────────┐       ┌────────────────────┐
   │    FFMPEG    │──────►│ SISTEMA DE ARCHIVOS│ ◄─── En Docker: Volúmenes
   │ (Subproceso) │       │ (Carpetas Locales) │ ◄─── Sin Docker: Disco Duro
   └──────────────┘       └────────────────────┘
                              (Uploads / Outputs)
```

## AUTOR

### **hzhou2026**  

[![hzhou2026](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hzhou2026)

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/hzhou04/)

## LICENCIA 
![I](https://github.com/hzhou2021/LTAW-Practicas/blob/main/P0/wiki/Logo-cc-by-sa.svg)
