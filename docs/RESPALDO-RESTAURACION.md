# Respaldo, restauración y traslado

El mecanismo canónico de continuidad de Inventario Terreno es el **respaldo operacional**. Reúne una instantánea coherente de SQLite, toda la evidencia referenciada y un manifiesto verificable.

## 1. Crear y verificar el respaldo canónico

Con el servidor detenido al cierre de jornada:

```powershell
npm.cmd run backup:operational
npm.cmd run backup:verify
```

Cada directorio `backups\operational\backup-...` contiene:

```text
inventario.sqlite
evidence/
manifest.json
```

`manifest.json` registra SHA-256 y tamaño de SQLite, conteos operacionales, y tamaño, SHA-256 y ruta relativa de cada evidencia. Un respaldo con resultado distinto de `PASS` no debe transferirse ni restaurarse.

## 2. Verificar un respaldo específico

`backup:verify` comprueba el respaldo operacional más reciente. Para una copia descargada o una ruta concreta use:

```powershell
node .\src\database\operational-backup.js verify "D:\RESPALDOS\backup-XXXXXXXX"
```

La verificación es de sólo lectura y controla el manifiesto, SQLite, `integrity_check`, `foreign_key_check`, conteos, evidencias y la integridad operacional.

## 3. Empaquetar para almacenamiento externo

```powershell
npm.cmd run backup:package
```

Para indicar una fuente concreta:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-operational-backup.ps1 `
  -BackupPath "D:\RESPALDOS\backup-XXXXXXXX"
```

La utilidad verifica primero la fuente y crea en `backups\packages\`:

```text
backup-XXXXXXXX.zip
backup-XXXXXXXX.zip.sha256.txt
```

No sube archivos ni guarda credenciales. El operador debe custodiar ambos archivos en almacenamiento privado y comparar el SHA-256 después de cada transferencia.

## 4. Restauración operacional segura

En una instalación nueva, con el servidor detenido y sin datos de destino:

```powershell
node .\src\database\operational-backup.js restore `
  "D:\RESPALDOS\backup-XXXXXXXX" `
  "C:\NuevaInstalacion\inventario-terreno" `
  --confirm
```

El restaurador:

- verifica completamente el respaldo antes de copiar;
- se niega si `TARGET\data\inventario.sqlite` existe;
- se niega si `TARGET\data` o `TARGET\evidence` contienen archivos;
- copia sólo a un staging temporal dentro de `TARGET`;
- conserva las rutas relativas de evidencia;
- verifica SHA-256, SQLite, claves foráneas, conteos, evidencias e integridad de campo;
- publica `data/` y `evidence/` sólo después de un `PASS` completo;
- no modifica ni elimina el backup fuente.

Nunca mezcle dos bases SQLite ni fusione carpetas de evidencia.

## 5. Ensayo de recuperación

```powershell
npm.cmd run recovery:drill
```

Para una fuente concreta:

```powershell
npm.cmd run recovery:drill -- --backup "D:\RESPALDOS\backup-XXXXXXXX"
```

El ensayo restaura en un directorio temporal, verifica el resultado y lo limpia al terminar. `--keep` conserva explícitamente el temporal para diagnóstico.

## 6. Comando antiguo LEGACY

```powershell
npm.cmd run backup
```

Este comando es **LEGACY / respaldo SQLite simple**. Se conserva por compatibilidad, pero no incluye evidencia ni `manifest.json` y no es el procedimiento principal de recuperación ante desastre. Del mismo modo, `setup.ps1 -Mode RESTAURAR` restaura sólo una SQLite autorizada y no reemplaza al restaurador operacional integrado.

## 7. Después de restaurar

```powershell
npm.cmd run verify:field
npm.cmd test
npm.cmd run test:mobile
npm.cmd run release:check
```

Luego inicie con `Iniciar Inventario Terreno.cmd`, compruebe `http://localhost:3180` y cree inmediatamente un nuevo respaldo operacional.

## 8. Qué no forma parte del respaldo operacional

No incluya automáticamente certificados, claves privadas, tokens, `.env`, cachés, `node_modules/` ni el código fuente como sustituto de GitHub.

El software se recupera desde GitHub. SQLite y fotografías se recuperan desde un respaldo operacional privado verificado. El procedimiento completo para pérdida total está en [RECUPERACION-DESASTRE.md](RECUPERACION-DESASTRE.md).
