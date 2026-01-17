# Video Converter Pro

Sistema avanzado de conversión de video con interfaz web, desarrollado como Trabajo Final de Grado.

## Características

- Subida de archivos mediante drag & drop
- Múltiples presets de conversión (H.264, H.265, AV1, VP9, ProRes, etc.)
- Opciones avanzadas de personalización
- Monitoreo en tiempo real con WebSockets
- Cola de trabajos con Redis
- Completamente dockerizado
- Interfaz responsive y moderna

---

## Inicio rápido con Docker

### Requisitos previos

- Docker 20.10 o superior
- Docker Compose 2.0 o superior
- 4 GB de memoria RAM (mínimo recomendado)
- 10 GB de espacio libre en disco

En caso de no disponer de Docker, puede instalarse desde la web oficial:  
https://www.docker.com/products/docker-desktop/

---

### Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/hzhou2026/Video-Converter-Pro.git
cd Video-Converter-Pro

# 2. Iniciar la aplicación mediante los scripts proporcionados
```

#### Windows

```bash
# Ejecutar en CMD o PowerShell
start.bat
# o alternativamente
.\start.bat
```

#### Linux

```bash
# Otorgar permisos de ejecución al script
chmod +x start.sh

# Ejecutar el script
./start.sh
```

---

### Acceso a la aplicación

- Acceso local: http://localhost  
- Acceso público: utilizar el enlace generado automáticamente en la salida de la consola (Cloudflare Tunnel)

---

### Ejecución manual con Docker Compose (opcional)

```bash
# En caso de no desear exposición pública mediante Cloudflare Tunnel,
# eliminar o comentar el siguiente bloque en docker-compose.yml

# ============================================
# Cloudflare Tunnel
# ============================================
cloudflare-tunnel:
  image: cloudflare/cloudflared:latest
  container_name: video-converter-tunnel
  restart: unless-stopped
  command: tunnel --no-autoupdate --url http://frontend:80
  depends_on:
    - frontend
  networks:
    - video-converter-network
```

```bash
# Construir e iniciar los contenedores manualmente
docker compose up -d --build
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

# Esto borra TODO ¡Cuidado! (Usar para una detención limpia)
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
   ┌───────────────────────────────────┐
   │      SERVIDOR WEB / PROXY         │ ◄─── En Docker: Nginx usando proxy pass
   │      (Frontend Entrypoint)        │ ◄─── Sin Docker: Vite / Localhost
   └────────────────┬──────────────────┘
                    │ ▲
                    │ │ 2. CANAL DE DATOS
                    │ │  (Comunicación Bidireccional)  ◄─── Sin Docker: Disco Duro  ◄─── En Docker: Volúmenes
                    ▼ │
   ┌───────────────────────────────────┐
   │        SERVICIO BACKEND           │ ◄─── Node.js (Express + Socket.IO)
   │     (Gestor de Conversiones)      │
   └────┬───▲──────┬────────▲──────────┘
        │   │      │        │        
        │   │      │ 3.COLA │        
 4. I/O │   │      │ ESTADO │     
ARCHIVOS│   │      ▼        │         
        │   │   ┌───────────┴────┐  
        │   │   │   SERVICIO     │   
        │   │   │     REDIS      │   
        │   │   └────────────────┘   
        │   │6. DESCARGAR                        
        │   │   RESULTADO             5. PROCESAMIENTO        
        ▼   │                             │ 
   ┌────────────────────────┐        ┌────┴──────────────┐
   │ SISTEMA DE ARCHIVOS    │───────►│     FFMPEG        │
   │ (Carpetas Locales)     │◄───────│   (Subproceso)    │
   └────────────────────────┘        └───────────────────┘
       (Uploads / Outputs)  
       Sin Docker: Disco Duro 
       En Docker: Volúmenes
```

## AUTOR

### **hzhou2026**  

[![hzhou2026](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hzhou2026)

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/hzhou04/)

## LICENCIA 
![I](https://github.com/hzhou2021/LTAW-Practicas/blob/main/P0/wiki/Logo-cc-by-sa.svg)
