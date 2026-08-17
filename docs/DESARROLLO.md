# Desarrollo y mantenimiento

Esta guía describe la arquitectura del proyecto para mantenerlo sin depender del contexto histórico de su creación.

## Arquitectura

```text
Navegador notebook ─┐
                    ├── Express / API ─── SQLite
Navegador móvil  ───┘          │
                               ├── evidence/
                               └── ExcelJS (importación inicial)
```

## Carpetas

```text
public/      HTML, CSS y JavaScript del cliente
src/api/     rutas HTTP
src/database/ conexión, esquema, migraciones y respaldo
src/importer/ lectura e importación XLSX
src/         lógica de operaciones, reportería y servidor
tests/       pruebas Vitest/Supertest
scripts/     PowerShell de preparación, red, HTTPS y launchers
docs/        documentación
```

## Principios de dominio

- El maestro representa lo que administrativamente **debería existir**.
- Una sesión representa lo **observado físicamente**.
- Una incidencia no regulariza automáticamente el maestro.
- Los códigos y folios se tratan como texto.
- Una oficina sólo cierra cuando el servidor declara `ready` el levantamiento.
- Las correcciones deben conservar trazabilidad.
- La evidencia no se destruye silenciosamente.

## Flujo normal

El caso correcto debe seguir siendo:

```text
código → Enter → registro → foco nuevamente en código
```

No agregue formularios al caso normal para resolver necesidades que sólo aparecen en incidencias.

## Móvil

El teléfono es un cliente auxiliar de una sesión existente. La sincronización actual se realiza mediante polling controlado y token temporal.

No introduzca WebSockets u offline complejo sin demostrar una necesidad operacional.

## Cámara

La cámara se usa para evidencia fotográfica. El lector de códigos por cámara, ZXing, BarcodeDetector y OCR no forman parte del flujo operativo vigente.

## SQLite y migraciones

Las migraciones deben ser:

- aditivas cuando sea posible;
- idempotentes;
- compatibles con datos históricos;
- probadas sobre bases sintéticas;
- precedidas por respaldo cuando operen sobre una base real.

No borre o reescriba sesiones históricas para simplificar una migración.

## Importación XLSX

La fuente de referencia es `imports/ACTIVOS.xlsx`, hoja `BD_SQL`.

La lectura y persistencia están separadas en `src/importer/`. El importador calcula SHA-256 para detectar cambios de la fuente durante lectura.

Consulte [FORMATO-DATOS.md](FORMATO-DATOS.md).

## Evidencia

Las imágenes viven en `evidence/`; SQLite conserva metadatos y rutas relativas seguras.

Las rutas servidas por API deben validar pertenencia a sesión/observación y evitar traversal.

No sirva `evidence/` como directorio estático navegable.

## Seguridad

Mantenga fuera de Git:

```text
imports/
data/
backups/
evidence/
exports/
local-certs/
.env*
```

No agregue datos reales a fixtures ni capturas de documentación.

## Pruebas

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

## Pruebas de terreno relevantes

El conjunto actual cubre, entre otros:

- normalización de códigos;
- sesiones;
- concurrencia;
- móvil;
- incidencias;
- no encontrado;
- provisionales;
- discrepancias;
- evidencia;
- cierre;
- reportería;
- simulación de oficina.

Una prueba automatizada no sustituye ergonomía, cámara o conectividad física; documente siempre qué requiere validación real.

## Dependencias

Mantenga Node.js 24.x mientras `package.json` lo declare.

Para instalaciones reproducibles:

```powershell
npm.cmd ci
```

No use `npm audit fix --force` automáticamente. Analice primero el impacto de cualquier cambio mayor.

## Commits

No mezcle en un mismo commit:

- código funcional;
- datos reales;
- fotografías;
- respaldos;
- certificados.

Los datos operacionales nunca deben entrar al repositorio.
