#!/bin/bash

echo "=========================================="
echo "       Iniciando Video Converter"
echo "=========================================="
echo ""

echo "Levantando contenedores..."
docker compose up -d --build

echo ""
echo "Esperando que los servicios estén listos..."
sleep 15

echo ""
echo "Obteniendo URL pública de Cloudflare..."
echo ""

# Esperar un poco más para que Cloudflare genere la URL
sleep 5

# Obtener la URL de Cloudflare desde los logs
CLOUDFLARE_URL=$(docker logs video-converter-tunnel 2>&1 | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1)

echo "=========================================="
echo "     Servidor iniciado correctamente      "
echo "=========================================="
echo ""
echo "URLs disponibles:"
echo ""
echo "Local: http://localhost"
echo ""

if [ -n "$CLOUDFLARE_URL" ]; then
    echo "Público (Cloudflare): $CLOUDFLARE_URL"
    echo ""
else
    echo "Aún generando URL pública..."
    echo "Posible falla al obtener la URL de Cloudflare."
fi