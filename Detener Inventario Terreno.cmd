@echo off
setlocal
chcp 65001 >nul
title Detener Inventario Terreno

set "PROJECT_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\stop-launcher.ps1"

if errorlevel 1 (
  echo.
  echo No se pudo detener Inventario Terreno de forma segura.
  echo Revise el mensaje anterior o solicite asistencia.
  echo.
  pause
)

endlocal
