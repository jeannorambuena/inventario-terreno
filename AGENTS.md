# Reglas del proyecto Inventario Terreno

Estas instrucciones se aplican a todo el repositorio y deben leerse antes de modificar, instalar u operar una copia.

## Propósito

Inventario Terreno es una aplicación local para Windows que permite comparar una base maestra con la realidad física observada durante una visita de terreno.

El flujo conceptual es:

```text
MAESTRO
→ VISITA
→ REALIDAD FÍSICA
→ INCIDENCIAS + EVIDENCIA
→ CONCILIACIÓN
→ REGULARIZACIÓN
```

El sistema nunca modifica automáticamente el maestro.

## Arquitectura

- `src/`: servidor Express, API, dominio, SQLite, importación y reportería.
- `public/`: interfaz notebook, móvil e informes.
- `tests/`: pruebas Vitest/Supertest con datos sintéticos.
- `docs/`: instalación, operación, respaldo y handover.
- `scripts/`: PowerShell para preparación, verificación, HTTPS y launchers.
- `imports/`: planillas privadas locales; nunca se versionan.
- `data/`: SQLite privada local; nunca se versiona.
- `backups/`: respaldos privados; nunca se versionan.
- `evidence/`: fotografías/evidencias; nunca se versionan.
- `exports/`: salidas operacionales; nunca se versionan.
- `local-certs/`: certificados y claves HTTPS locales; nunca se versionan.

## Tecnología aprobada

- Windows 10/11.
- Node.js 24.x.
- JavaScript ES Modules.
- Express.
- SQLite con `better-sqlite3`.
- ExcelJS.
- HTML/CSS/JavaScript sin framework frontend complejo.
- PowerShell para scripts operativos.

No introducir Docker, nube, IA, OCR, ZXing, BarcodeDetector, GPS, WebSockets u offline complejo sin una necesidad operacional demostrada.

## Flujo operativo vigente

El caso normal debe seguir siendo:

```text
CÓDIGO → Enter → registrado → siguiente
```

No agregar formularios al flujo correcto.

La cámara del teléfono se utiliza sólo para evidencia fotográfica tipificada. No existe lectura operativa de códigos por cámara.

## Cierre de oficina

El cliente no decide por sí solo que una oficina está completa.

El servidor debe evaluar si la sesión está lista para cierre.

Una sesión normal no debe cerrar con:

- bienes esperados pendientes;
- ambigüedades sin resolver;
- provisionales incompletos;
- discrepancias insuficientemente documentadas;
- evidencia requerida ausente o alterada;
- incidencias estructuralmente inválidas.

La pantalla **¿Puedo salir de esta oficina?** debe reflejar la evaluación del servidor.

## Trazabilidad

Correcciones, anulaciones, evidencia, excepciones y cierres deben conservar historia y auditoría.

Nunca destruir silenciosamente observaciones o evidencia histórica.

Las sesiones cerradas son inmutables salvo un procedimiento explícito de migración compatible y probado.

## Protección de datos

- `imports/ACTIVOS.xlsx` es una fuente original de sólo lectura.
- Nunca publicar XLS/XLSX, CSV, SQLite, fotografías, exportaciones, respaldos, certificados, claves, `.env`, tokens o datos administrativos reales.
- Nunca usar datos reales en fixtures, pruebas o documentación.
- Nunca sobrescribir una SQLite existente durante una instalación/restauración.
- Mantener códigos e identificadores como `TEXT` y preservar ceros iniciales.
- No imprimir tokens móviles ni secretos en consola.
- Confirmar rutas privadas mediante `git check-ignore` antes de publicar.

## Instalación

La guía canónica es:

`docs/INSTALACION-WINDOWS.md`

El modo debe elegirse expresamente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Mode NUEVO
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Mode RESTAURAR
```

`setup.ps1` no instala herramientas del sistema automáticamente y no debe copiar datos sin autorización explícita.

GitHub CLI (`gh`) es opcional para una copia ya clonada.

## Operación

La forma normal de iniciar y detener es mediante:

```text
Iniciar Inventario Terreno.cmd
Detener Inventario Terreno.cmd
```

Los scripts `.ps1` son principalmente instalación, diagnóstico y soporte.

## HTTPS y móvil

HTTP utiliza el puerto 3180.

HTTPS local, cuando está configurado, utiliza 3443.

El teléfono debe operar en una red privada autorizada y usar un enlace temporal generado desde una sesión.

No abrir puertos hacia Internet.

Una VPN/WireGuard puede interferir con el acceso a la LAN; no modificar automáticamente la configuración VPN del dispositivo.

## Respaldos

El mecanismo canónico incluye SQLite, evidencias referenciadas y `manifest.json`:

```powershell
npm.cmd run backup:operational
npm.cmd run backup:verify
```

Para probar recuperación o preparar una copia externa verificada:

```powershell
npm.cmd run recovery:drill
npm.cmd run backup:package
```

`npm.cmd run backup` es **LEGACY / respaldo SQLite simple** y no es el procedimiento principal de recuperación. No copie SQLite y `evidence/` por separado como sustituto del respaldo operacional.

No mezclar certificados con respaldos de inventario.

## Reglas técnicas

- Usar ES Modules (`import`/`export`).
- Mantener compatibilidad con Node.js 24 mientras `package.json` lo declare.
- Mantener separadas importación, persistencia, API y presentación.
- Validar entradas y rutas.
- No concatenar SQL con datos externos.
- No exponer `evidence/` como directorio estático navegable.
- No instalar dependencias nuevas sin justificar su necesidad.

## Verificación

Antes de entregar cambios:

```powershell
npm.cmd test
npm.cmd run test:mobile
git diff --check
git status --short
```

Para una estación operacional completa:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

## Git

Antes de commit/push:

- revisar `git status --short`;
- confirmar que no haya datos reales;
- comprobar rutas privadas con `git check-ignore`;
- no usar `git add .` a ciegas;
- no forzar pushes sin una razón explícita.

Si falta una herramienta, existe conflicto de datos, una prueba falla o hay duda sobre privacidad, detenerse e informar antes de modificar datos reales.
