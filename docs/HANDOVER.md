# Handover entre equipos

## Objetivo

Este documento permite trasladar Inventario Terreno a otro equipo Windows sin depender del equipo original ni mezclar código con datos privados.

## Separación fundamental

### Código

Viaja por GitHub:

- `src/`
- `public/`
- `tests/`
- `scripts/`
- `docs/`
- `package.json`
- `package-lock.json`
- launchers `.cmd`

### Datos

Viajan por un canal autorizado separado:

- `imports/ACTIVOS.xlsx` u otra planilla maestra;
- `data/inventario.sqlite`;
- `evidence/`;
- respaldos;
- exportaciones reales.

### Configuración local

No se comparte por Git:

- `local-certs/`;
- claves privadas;
- CA local;
- `.env`;
- tokens.

## Traslado a un equipo nuevo

1. Instale Git y Node.js 24.x.
2. Clone la versión estable desde GitHub.
3. Ejecute `npm.cmd ci`.
4. Ejecute `npm.cmd test` y `npm.cmd run test:mobile`.
5. Decida explícitamente `NUEVO` o `RESTAURAR`.
6. Traslade un paquete operacional privado y su archivo SHA por separado.
7. Compare SHA-256 del ZIP antes y después del traslado.
8. Expanda y verifique el backup específico.
9. Use el restaurador operacional integrado para recuperar SQLite y `evidence/` juntos.
10. Configure HTTPS local si utilizará el terminal móvil.
11. Inicie mediante `Iniciar Inventario Terreno.cmd`.
12. Ejecute `verify.ps1` con el servidor activo.
13. Haga una prueba notebook + teléfono antes de una jornada real.

Consulte [INSTALACION-WINDOWS.md](INSTALACION-WINDOWS.md).

## Modo NUEVO

Se utiliza cuando el destino construirá su base a partir de una planilla compatible.

No debe existir previamente:

```text
imports/ACTIVOS.xlsx
data/inventario.sqlite
```

La importación debe realizarse mediante `scripts/setup.ps1 -Mode NUEVO` con autorización explícita.

## Modo RESTAURAR

Se utiliza cuando el destino continuará desde un respaldo operacional existente.

No copie manualmente una base encima de otra.

Use:

```powershell
node .\src\database\operational-backup.js verify "D:\RESPALDOS\backup-XXXXXXXX"
node .\src\database\operational-backup.js restore `
  "D:\RESPALDOS\backup-XXXXXXXX" `
  "C:\NuevaInstalacion\inventario-terreno" `
  --confirm
```

`scripts/setup.ps1 -Mode RESTAURAR` es una ruta **LEGACY** para SQLite simple; no recupera evidencia ni reemplaza el respaldo operacional con `manifest.json`.

## Inicio de jornada

1. Compruebe que el respaldo del día anterior existe.
2. Inicie con `Iniciar Inventario Terreno.cmd`.
3. Compruebe `http://localhost:3180`.
4. Conecte el teléfono sólo si será necesario.
5. Genere un enlace móvil nuevo desde la sesión.
6. No reutilice tokens antiguos.

## Operación

El flujo oficial es manual-first:

```text
código → Enter → siguiente
```

La cámara sólo sirve para evidencia fotográfica.

Antes de abandonar una oficina use:

**¿Puedo salir de esta oficina?**

El servidor debe declarar que la sesión está lista para cierre.

## Cierre de jornada

1. Finalice correctamente las sesiones terminadas.
2. Detenga mediante `Detener Inventario Terreno.cmd`.
3. Ejecute `npm.cmd run backup:operational`.
4. Ejecute `npm.cmd run backup:verify`.
5. Ejecute `npm.cmd run backup:package`.
6. Traslade el ZIP y su archivo SHA por un canal privado autorizado.
7. Verifique el SHA-256 y la integridad en destino.

## Evidencia mínima de handover

Sin incluir datos reales, registre:

- commit o versión del software;
- versión de Node.js;
- resultado de tests;
- resultado de `integrity_check`;
- hash SHA-256 del ZIP operacional transferido;
- resultado PASS de `manifest.json`, SQLite y todas las evidencias.

## Reemplazo del teléfono

El teléfono es auxiliar y no conserva estado indispensable para el handover. Un teléfono nuevo genera una identidad auxiliar nueva; desde una sesión válida se crea un enlace/QR temporal nuevo. No reutilice el `deviceId` ni pairing tokens del equipo anterior. Las evidencias ya confirmadas se recuperan desde el backup, no desde el teléfono.

Para robo o pérdida total de ambos equipos siga [RECUPERACION-DESASTRE.md](RECUPERACION-DESASTRE.md).

## Condiciones de detención

No continúe si:

- el hash cambia inesperadamente;
- SQLite no devuelve `integrity_check = ok`;
- ya existe una base destino que sería sobrescrita;
- faltan fotografías requeridas;
- aparecen datos privados preparados para Git;
- una prueba crítica falla.

Conserve los originales y resuelva la causa antes de reemplazar archivos.
