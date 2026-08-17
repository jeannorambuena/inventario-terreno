@echo off
setlocal
chcp 65001 >nul
title Inventario Terreno

set "PROJECT_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\launch.ps1"

if errorlevel 1 (
  echo.
  echo No se pudo iniciar Inventario Terreno.
  echo Revise el mensaje anterior o solicite asistencia.
  echo.
  pause
)

endlocal
