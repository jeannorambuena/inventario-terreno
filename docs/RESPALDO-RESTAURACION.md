# Respaldo, restauración y traslado

Inventario Terreno utiliza SQLite para el estado operacional y archivos locales para evidencia fotográfica.

## 1. Respaldo de SQLite

Desde la raíz del proyecto:

```powershell
npm.cmd run backup
```

El comando usa la API de respaldo de SQLite y crea una copia coherente en:

```text
backups/
```

No elimina respaldos anteriores.

## 2. Respaldo operacional completo

Si una jornada contiene fotografías, un respaldo completo debe contemplar:

```text
SQLite
+
evidence/
```

La base guarda referencias y metadatos de evidencia, pero las imágenes permanecen como archivos locales.

Por tanto:

- copiar sólo SQLite conserva sesiones, observaciones y metadatos;
- copiar SQLite + `evidence/` conserva también la evidencia visual.

## 3. Momento recomendado

Antes de una jornada:

```powershell
npm.cmd run backup
```

Después de cerrar las sesiones de la jornada:

```powershell
npm.cmd run backup
```

Para un traslado de equipo, detenga primero el servidor.

## 4. Hash SHA-256

Calcule una huella antes de transferir:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\backups\inventario-AAAA-MM-DD....sqlite'
```

Repita en el equipo destino y compare.

Para un conjunto de evidencias, conserve la carpeta sin renombrar internamente sus archivos.

## 5. Restaurar en un equipo nuevo

No coloque una base sobre otra existente.

Primero confirme:

```powershell
Test-Path .\data\inventario.sqlite
```

Debe devolver `False` antes de restaurar mediante el asistente seguro.

Luego:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 `
  -Mode RESTAURAR `
  -RestoreDatabasePath 'D:\RUTA-AUTORIZADA\inventario.sqlite' `
  -ConfirmDataOperation
```

El script valida la fuente SQLite antes de copiarla y se detiene si ya existe una base destino.

## 6. Restaurar evidencia

Con el servidor detenido, copie la carpeta de evidencia autorizada a:

```text
evidence/
```

Mantenga la estructura relativa original. No reorganice ni renombre fotografías manualmente.

Después inicie el sistema y compruebe desde los informes que las evidencias se abren correctamente.

## 7. Verificar integridad de SQLite

```powershell
node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database('data/inventario.sqlite',{readonly:true,fileMustExist:true}); console.log(db.pragma('integrity_check',{simple:true})); db.close();"
```

El resultado esperado es:

```text
ok
```

## 8. Qué no forma parte del respaldo operacional

No incluya automáticamente:

- `node_modules/`;
- certificados HTTPS de otro equipo;
- claves privadas;
- cachés;
- código fuente como sustituto de GitHub.

El código se recupera desde GitHub. Los datos se recuperan desde respaldos privados.

## 9. Recuperación ante fallo del notebook

En otro Windows compatible:

1. clone el código desde GitHub;
2. ejecute `npm.cmd ci`;
3. ejecute las pruebas;
4. restaure SQLite mediante `setup.ps1 -Mode RESTAURAR`;
5. restaure `evidence/` por separado;
6. configure HTTPS local si se utilizará el teléfono;
7. ejecute `verify.ps1`;
8. inicie con `Iniciar Inventario Terreno.cmd`.

## 10. Nunca fusionar bases manualmente

No copie tablas ni combine dos SQLite con herramientas externas durante una recuperación normal.

Si existen dos bases divergentes, consérvelas separadas y diseñe un procedimiento específico de conciliación antes de modificar cualquiera de ellas.
