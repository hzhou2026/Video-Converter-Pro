@echo off
chcp 65001 >nul
cls

echo ==========================================
echo        Iniciando Video Converter
echo ==========================================
echo.

echo Levantando contenedores...
docker compose up -d --build

echo.
echo Esperando que los servicios estén listos...
timeout /t 15 /nobreak >nul

echo.
echo Obteniendo URL pública de Cloudflare...
echo.

timeout /t 5 /nobreak >nul

REM Obtener la URL de Cloudflare desde los logs
for /f "tokens=*" %%i in ('docker logs video-converter-tunnel 2^>^&1 ^| findstr /R "https://.*\.trycloudflare\.com"') do set CLOUDFLARE_URL=%%i

echo ==========================================
echo      Servidor iniciado correctamente
echo ==========================================
echo.
echo URLs disponibles:
echo.
echo Local: http://localhost
echo.

if defined CLOUDFLARE_URL (
    echo Público ^(Cloudflare^): %CLOUDFLARE_URL%
    echo.
) else (
    echo Aún generando URL pública...
    echo Posible falla al obtener la URL de Cloudflare.
    echo.
)

pause