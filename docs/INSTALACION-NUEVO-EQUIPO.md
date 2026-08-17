# Instalación en el notebook Dell con Windows

El equipo operativo definitivo es un notebook Dell personal con Windows 10 u 11. El HP 240 G6 con Linux Mint no forma parte del entorno de operación y este proyecto no mantiene scripts Bash.

## 1. Preparar Windows

Instale de forma explícita y desde fuentes oficiales:

- Git;
- GitHub CLI (`gh`);
- Node.js 24.x con npm;
- Windows PowerShell 5.1 o PowerShell 7;
- `mkcert` cuando se habilitará cámara por HTTPS.

Compruebe versiones:

```powershell
git --version
gh --version
node --version
npm.cmd --version
mkcert -version
```

No reinstale herramientas compatibles ni permita que scripts descarguen ejecutables automáticamente.

## 2. Clonar desde GitHub

```powershell
gh auth login
gh auth status
gh repo clone jeannorambuena/inventario-terreno
Set-Location .\inventario-terreno
git status --branch --short
```

Lea `AGENTS.md`. El clon contiene código y pruebas sintéticas, nunca datos municipales.

## 3. Instalar dependencias y elegir modo

Use siempre `npm.cmd` en PowerShell:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:mobile
```

El flujo asistido exige una elección expresa:

```powershell
.\scripts\setup.ps1 -Mode NUEVO
.\scripts\setup.ps1 -Mode RESTAURAR
```

Sin una ruta de datos autorizada, ambos modos preparan dependencias y pruebas pero no importan ni restauran nada. Si PowerShell bloquea scripts, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`; el cambio se limita a ese proceso.

## 4. Copiar datos por separado

Git no transporta `ACTIVOS.xlsx`, `inventario.sqlite` ni respaldos. Use un medio autorizado, preferentemente cifrado, y mantenga Excel y SQLite separados del clon hasta verificar sus huellas.

### Fuente Excel para modo NUEVO

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'UNIDAD_AUTORIZADA:\ACTIVOS.xlsx'
.\scripts\setup.ps1 -Mode NUEVO -ImportExcelPath 'UNIDAD_AUTORIZADA:\ACTIVOS.xlsx' -ConfirmDataOperation
Get-FileHash -Algorithm SHA256 -LiteralPath '.\imports\ACTIVOS.xlsx'
```

Compare ambas huellas. La operación se detiene si `imports/ACTIVOS.xlsx` o `data/inventario.sqlite` ya existen.

### SQLite para modo RESTAURAR

Antes de copiar, confirme que no exista una base destino:

```powershell
Test-Path -LiteralPath '.\data\inventario.sqlite'
Get-FileHash -Algorithm SHA256 -LiteralPath 'UNIDAD_AUTORIZADA:\inventario.sqlite'
.\scripts\setup.ps1 -Mode RESTAURAR -RestoreDatabasePath 'UNIDAD_AUTORIZADA:\inventario.sqlite' -ConfirmDataOperation
Get-FileHash -Algorithm SHA256 -LiteralPath '.\data\inventario.sqlite'
```

Valide integridad SQLite en modo lectura:

```powershell
node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database('data/inventario.sqlite',{readonly:true,fileMustExist:true}); console.log(db.pragma('integrity_check',{simple:true})); db.close();"
```

Nunca sobrescriba una SQLite existente. Si el destino existe, deténgase y decida el traspaso con el responsable de los datos.

## 5. Configurar HTTPS y cámara

Consulte [HTTPS-CAMARA.md](HTTPS-CAMARA.md). Resumen:

```powershell
# Vista previa; no crea certificados.
.\scripts\setup-https.ps1

# Creación explícita e instalación de la CA solo en el Dell.
.\scripts\setup-https.ps1 -ConfirmCertificateCreation -InstallLocalCA
```

El certificado incluye `localhost`, `127.0.0.1`, las IP LAN detectadas y opcionalmente una IP privada adicional:

```powershell
.\scripts\setup-https.ps1 -AdditionalIp 'IP_PRIVADA_ADICIONAL' -ConfirmCertificateCreation -ConfirmOverwrite
```

La CA del Samsung se instala y retira manualmente. Nunca se copia a Git ni se instala automáticamente en el teléfono.

## 6. Verificar y arrancar

Con 3180 y 3443 libres:

```powershell
.\scripts\verify.ps1
.\scripts\start.ps1
```

`start.ps1` no importa datos. Inicia HTTP en `0.0.0.0:3180` y, si existen certificado y clave, HTTPS en `0.0.0.0:3443`. Muestra las URL locales y LAN.

Después del arranque, vuelva a ejecutar `verify.ps1` desde otra consola para comprobar HTTP y HTTPS local/LAN. En Firewall de Windows permita Node.js únicamente para redes privadas.

## 7. Wi-Fi municipal y hotspot

En Wi-Fi de una unidad municipal:

1. Conecte Dell y Samsung a la misma red autorizada.
2. Compruebe la IP privada y regenere el certificado si cambió.
3. No eluda aislamiento de clientes ni otras políticas de red.
4. No abra puertos al exterior.

En terreno con hotspot:

1. Conecte ambos equipos al hotspot autorizado.
2. Detecte la nueva IP del Dell.
3. Regenere el certificado si la IP no estaba incluida.
4. Use `https://IP_DEL_DELL:3443`.

Si la cámara sigue bloqueada, la entrada manual continúa completamente disponible.

## 8. Rutina de cada jornada

Antes de comenzar:

```powershell
npm.cmd test
npm.cmd run test:mobile
npm.cmd run backup
.\scripts\verify.ps1
```

Después de cerrar las sesiones de la jornada:

```powershell
npm.cmd run backup
```

Registre fecha, hash SHA-256 y medio autorizado del respaldo sin incluir datos administrativos en documentación o Git.

## 9. Trasladar resultados al equipo principal

1. Cierre la operación y detenga el servidor de forma controlada.
2. Ejecute un respaldo final.
3. Calcule SHA-256 del respaldo.
4. Cópielo mediante un medio autorizado y cifrado, nunca por Git.
5. En el equipo principal, vuelva a calcular SHA-256 y compare.
6. Abra la copia en modo lectura y ejecute `PRAGMA integrity_check`.
7. Conserve el archivo recibido como evidencia separada. No sobrescriba automáticamente la SQLite principal ni intente fusionar bases sin un procedimiento autorizado.
8. Cuando el traspaso esté confirmado, retire la CA del Samsung siguiendo `HTTPS-CAMARA.md` si ya no se utilizará.

## Bloqueos seguros

Deténgase si falla una prueba, falta una herramienta, 3180/3443 están ocupados, cambia la IP, la CA no es confiable, una ruta privada no está ignorada o ya existe un destino de datos. No improvise con datos reales.
