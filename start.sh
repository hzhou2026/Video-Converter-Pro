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

# Obtener IP local
LOCAL_IP=$(hostname -I | awk '{print $1}')

# Alternativa más robusta para obtener IP (por si hostname -I falla)
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(ip route get 1 | awk '{print $(NF-2);exit}')
fi

echo "=========================================="
echo "     Servidor iniciado correctamente      "
echo "=========================================="
echo ""
echo "URLs disponibles:"
echo ""
echo "Local (este dispositivo): http://localhost"
echo "Red local (otros dispositivos): http://$LOCAL_IP"
echo ""

if [ -n "$CLOUDFLARE_URL" ]; then
    echo "Público (Cloudflare): $CLOUDFLARE_URL"
    echo ""
else
    echo "Aún generando URL pública..."
    echo "Posible falla al obtener la URL de Cloudflare."
fi