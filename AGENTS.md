# Reglas del proyecto Inventario Terreno

Estas instrucciones se aplican a todo el repositorio y deben leerse antes de operar un clon nuevo.

## Propósito y arquitectura

Inventario Terreno es una aplicación local y offline para Windows. Un notebook ejecuta Node.js/Express y guarda la copia de trabajo en SQLite; la interfaz web del notebook y un teléfono conectado a la misma red privada consumen la API local. ExcelJS lee `imports/ACTIVOS.xlsx` como fuente protegida de solo lectura.

- `src/`: servidor Express, API, base SQLite, importación y utilidades de red.
- `public/`: interfaz del notebook y vista móvil, sin datos reales incorporados.
- `tests/`: pruebas Vitest/Supertest con datos completamente sintéticos.
- `docs/`: instalación, traspaso, operación y decisiones del proyecto.
- `scripts/`: instalación, verificación y arranque seguros para PowerShell.
- `imports/`: planillas privadas locales; nunca se versionan.
- `data/`: SQLite privada local; nunca se versiona ni se sobrescribe.
- `backups/`: respaldos privados locales; nunca se versionan.

La tecnología aprobada es HTML, CSS, JavaScript ES Modules, Node.js 24, Express, SQLite y ExcelJS. El MVP no usa Docker, PHP, Java, servicios en la nube, telemetría ni APIs de inteligencia artificial.

## Requisitos del equipo

- Git.
- GitHub CLI (`gh`) autenticado cuando se necesite clonar o publicar.
- Node.js 24.x y npm incluido.
- Windows PowerShell 5.1 o PowerShell 7.
- En PowerShell usar `npm.cmd` y `npx.cmd`, especialmente si la política bloquea `npm.ps1` o `npx.ps1`.

No reinstalar herramientas que ya cumplen la versión requerida. Si falta una herramienta, informar el bloqueo y solicitar su instalación; no descargar ejecutables de fuentes improvisadas.

## Instalación y operación

Desde la raíz del repositorio:

```powershell
# El modo debe elegirse expresamente; sin modo el script se detiene.
.\scripts\setup.ps1 -Mode NUEVO
.\scripts\setup.ps1 -Mode RESTAURAR

# Verificación integral.
.\scripts\verify.ps1

# Dependencias reproducibles y pruebas (también ejecutadas por setup).
npm.cmd ci
npm.cmd test
npm.cmd run test:mobile

# Respaldo consistente de la base actual.
npm.cmd run backup

# Servidor activo en primer plano.
.\scripts\start.ps1
```

`start.ps1` no importa datos. Debe comprobar que el puerto `3180` esté libre, iniciar el servicio en `0.0.0.0:3180`, mostrar `http://localhost:3180` y las URLs de la LAN, y dejar el proceso activo.

Antes de iniciar operación real, ejecutar las pruebas generales y móviles. Después verificar HTTP `200` tanto en localhost como en una IPv4 privada del notebook. No configurar redirección de puertos ni exponer el servicio a Internet.

## Protección de datos

- Tratar `imports/ACTIVOS.xlsx` como fuente original de solo lectura: nunca modificarla, sobrescribirla, renombrarla ni usarla como salida.
- Nunca publicar XLS/XLSX, CSV, SQLite, bases de datos, fotografías, exportaciones, respaldos, certificados, claves, `.env`, tokens ni datos municipales.
- No importar ni restaurar datos sin autorización explícita del usuario y una elección expresa de modo.
- Nunca sobrescribir `data/inventario.sqlite`. Si ya existe y se intenta importar o restaurar otra base, detenerse e informar el conflicto.
- No borrar ni reiniciar sesiones u observaciones existentes. Las sesiones cerradas son evidencia histórica.
- Mantener datos reales fuera de fixtures, capturas, logs, documentación y mensajes de prueba.
- Usar en pruebas solo datos sintéticos que no deriven de registros reales.
- Guardar códigos, identificadores y folios como `TEXT` en todas las capas y preservar ceros iniciales.
- No imprimir tokens móviles, secretos o datos administrativos en consola.

Los directorios `imports/`, `data/` y `backups/` son privados incluso cuando existen solo en el equipo de operación. Confirmar siempre su exclusión con `git check-ignore`.

## Reglas técnicas

- Usar JavaScript ES Modules (`import`/`export`), no CommonJS.
- Mantener compatibilidad con Node.js 24.
- Mantener separadas la lectura Excel, persistencia SQLite, API y presentación.
- Validar entradas, rutas y nombres de archivo. No construir SQL concatenando datos externos.
- El servidor operativo debe escuchar en `0.0.0.0:3180`, pero aceptar clientes solo de localhost o redes IPv4 privadas.
- No instalar dependencias nuevas sin justificar su necesidad dentro de la tecnología aprobada.

## Verificación y bloqueos

- Ejecutar `npm.cmd test`, `npm.cmd run test:mobile` y `git diff --check` antes de entregar cambios.
- Revisar `git status --short` y confirmar que no aparezcan artefactos sensibles.
- Verificar `http://localhost:3180` y al menos una URL LAN cuando el servidor esté activo.
- No hacer commits, push, PR ni crear remotos salvo solicitud explícita.
- Si falta una herramienta, el puerto está ocupado, hay conflicto de datos, no existe autorización o una prueba falla, detenerse, explicar el bloqueo con evidencia y no improvisar usando datos reales.
