# Reglas del proyecto Inventario Terreno

Estas instrucciones se aplican a todo el repositorio.

## Alcance y tecnología

- Construir una aplicación local y offline para Windows.
- Usar únicamente HTML, CSS y JavaScript con Node.js 24, módulos ES, Express, SQLite y ExcelJS.
- Mantener el MVP sin Docker, PHP, Java ni APIs de inteligencia artificial.
- No agregar servicios en la nube, telemetría ni dependencias de red en tiempo de ejecución.
- Cuando exista un servidor local, limitarlo por defecto a `127.0.0.1`.

## Protección de datos

- Tratar `ACTIVOS.xlsx` como fuente original de solo lectura: nunca modificarlo, sobrescribirlo, renombrarlo ni usarlo como archivo de salida.
- No versionar archivos XLSX, XLS, CSV, SQLite, bases de datos, fotografías, exportaciones, respaldos, certificados, claves, archivos `.env` ni datos municipales.
- Mantener datos reales fuera del repositorio y de sus fixtures, capturas, logs y documentación.
- Usar en pruebas únicamente datos completamente sintéticos, sin copiar ni transformar registros municipales reales.
- Guardar códigos, identificadores, folios y valores equivalentes como texto en cada capa. En SQLite deben usar afinidad `TEXT`; al leer Excel deben convertirse de forma explícita a texto sin perder ceros iniciales.
- No aplicar conversiones numéricas, notación científica, redondeo ni normalización destructiva a códigos.

## Organización técnica futura

- `src/`: código del servidor, acceso a datos y lógica de dominio, separado por responsabilidades.
- `public/`: interfaz web estática local (HTML, CSS, JavaScript y recursos no sensibles).
- `tests/`: pruebas automatizadas y fixtures exclusivamente sintéticos.
- `docs/`: decisiones, alcance y planificación del proyecto.
- Mantener la lógica de lectura de Excel separada de la persistencia SQLite y de las rutas HTTP.
- Validar entradas, rutas de archivos y nombres de exportación; no construir SQL mediante concatenación de datos externos.

## JavaScript y herramientas

- Usar JavaScript ES Modules (`import`/`export`), no CommonJS.
- Mantener compatibilidad con Node.js 24.
- No instalar una dependencia sin justificar su necesidad dentro de la tecnología aprobada.
- En Windows, usar `npm.cmd` y `npx.cmd` cuando PowerShell bloquee los wrappers `npm.ps1` o `npx.ps1`.
- No incluir secretos en comandos, código, logs ni mensajes de error.

## Verificación

- Antes de terminar un cambio, revisar `git status --short` y confirmar que no aparezcan datos o artefactos sensibles.
- Las pruebas futuras deben comprobar de forma explícita la conservación de ceros iniciales y el carácter de solo lectura de `ACTIVOS.xlsx`.
- No hacer commits, publicar ramas ni crear repositorios remotos salvo solicitud explícita del usuario.
