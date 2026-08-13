# Hoja de ruta

Este documento describe etapas futuras. La estructura inicial no implementa ninguna de ellas todavía.

## 0. Base segura

- Definir reglas técnicas y de protección de datos.
- Configurar exclusiones estrictas de Git.
- Crear la estructura mínima de `src`, `public`, `tests` y `docs`.

## 1. Diseño y validación

- Levantar requisitos funcionales del flujo de inventario en terreno.
- Documentar el formato esperado de `ACTIVOS.xlsx` sin copiar datos reales al repositorio.
- Definir un esquema SQLite con códigos e identificadores almacenados como `TEXT`.
- Diseñar la separación entre importación, dominio, persistencia, servidor e interfaz.

## 2. Núcleo local

- Incorporar Express, SQLite y ExcelJS cuando se autorice instalar dependencias.
- Implementar lectura no destructiva de `ACTIVOS.xlsx`.
- Crear una copia de trabajo SQLite local y no versionada.
- Validar que los códigos conserven exactamente sus ceros iniciales.

## 3. Interfaz offline

- Crear la interfaz con HTML, CSS y JavaScript.
- Implementar búsqueda, consulta y actualización del inventario local según los requisitos aprobados.
- Mantener toda la operación dentro del equipo Windows, sin servicios externos.

## 4. Calidad y entrega

- Agregar pruebas unitarias y de integración con datos completamente sintéticos.
- Verificar recuperación ante errores sin modificar la planilla original.
- Revisar seguridad, accesibilidad y funcionamiento offline.
- Documentar instalación, uso, respaldo y exportación segura para Windows.

## Fuera del MVP

- Docker.
- PHP o Java.
- APIs de inteligencia artificial.
- Servicios en la nube, sincronización remota o telemetría.
