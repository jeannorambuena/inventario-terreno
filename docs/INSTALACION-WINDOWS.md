# Instalación en Windows desde GitHub

Esta guía permite reconstruir **Inventario Terreno** en un equipo Windows nuevo sin depender del historial de desarrollo ni de datos privados del equipo original.

> GitHub contiene el software. Las planillas, la base SQLite, fotografías, certificados y respaldos se trasladan por separado.

## 1. Requisitos

- Windows 10 u 11.
- Git.
- Node.js 24.x, con npm incluido.
- Windows PowerShell 5.1 o PowerShell 7.
- Python 3 disponible para `node-gyp` si una dependencia nativa debe compilarse.
- Visual Studio Build Tools 2022 con la carga **Desktop development with C++** cuando `better-sqlite3` no disponga de un binario precompilado compatible con la versión de Node utilizada.
- GitHub CLI (`gh`) sólo si se desea usar autenticación mediante `gh`; no es obligatorio para un clon HTTPS que ya funcione.
- `mkcert` para la verificación HTTPS completa y el uso móvil con certificado local confiable.
- Navegador moderno.

Compruebe:

```powershell
git --version
node --version
npm.cmd --version
python --version
```

Node debe ser 24.x.

### 1.1 Build Tools C++ para Windows

En una instalación limpia real de Windows con Node.js 24, `npm.cmd ci` necesitó compilar `better-sqlite3` mediante `node-gyp`. Si el equipo no tiene compilador C++, aparece un error similar a:

```text
gyp ERR! find VS
You need to install the latest version of Visual Studio
including the "Desktop development with C++" workload.
```

Instale únicamente Visual Studio Build Tools 2022 con la carga C++:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
  --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
  --accept-package-agreements `
  --accept-source-agreements
```

Verifique que el compilador x64/x86 quedó instalado:

```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
& $vswhere `
  -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath
```

Debe devolver una ruta similar a:

```text
C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools
```

No instale el IDE completo de Visual Studio si sólo necesita compilar las dependencias del proyecto.

## 2. Clonar el software

Para el repositorio oficial, con una cuenta que tenga acceso:

```powershell
git clone https://github.com/jeannorambuena/inventario-terreno.git
cd inventario-terreno
```

Si el repositorio es privado y Git solicita autenticación, también puede utilizar:

```powershell
gh auth login
gh repo clone jeannorambuena/inventario-terreno
cd inventario-terreno
```

Compruebe la rama y el estado:

```powershell
git branch --show-current
git status --short
```

Para una instalación de producción use la rama estable publicada por el proyecto, normalmente `main` después de la liberación.

## 3. Instalar dependencias reproducibles

```powershell
npm.cmd ci
```

No utilice `npm install` para una instalación reproducible si `package-lock.json` ya existe.

Si `npm.cmd ci` falla con `gyp ERR! find VS`, instale los Build Tools C++ indicados en la sección 1.1 y repita `npm.cmd ci`. No ejecute `npm audit fix --force` para intentar resolver este problema.

Durante la instalación pueden aparecer avisos `deprecated` y un informe de vulnerabilidades transitivas. Consulte la documentación del proyecto antes de aplicar cambios automáticos de dependencias.

Ejecute las pruebas antes de introducir datos reales:

```powershell
npm.cmd test
npm.cmd run test:mobile
git diff --check
git status --short
```

Una instalación limpia validada debe terminar con todas las pruebas aprobadas y sin modificaciones locales del repositorio.

## 4. Elegir el tipo de instalación

Hay dos escenarios distintos.

### A. NUEVO

Se utiliza cuando se dispone de una planilla maestra XLSX y se quiere crear una base SQLite nueva.

Primero puede preparar el entorno sin copiar datos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Mode NUEVO
```

Para importar una fuente autorizada:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 `
  -Mode NUEVO `
  -ImportExcelPath 'D:\RUTA-AUTORIZADA\ACTIVOS.xlsx' `
  -ConfirmDataOperation
```

El script se detiene si ya existe `imports/ACTIVOS.xlsx` o `data/inventario.sqlite`.

### B. RESTAURAR

Se utiliza para trasladar una base SQLite existente desde otro equipo.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 `
  -Mode RESTAURAR `
  -RestoreDatabasePath 'D:\RUTA-AUTORIZADA\inventario.sqlite' `
  -ConfirmDataOperation
```

Nunca restaure encima de una base existente.

Una restauración operacional completa puede requerir además copiar, por separado y conservando su estructura relativa:

- `evidence/` si existen fotografías/evidencias;
- `imports/ACTIVOS.xlsx` si se desea conservar la fuente maestra utilizada;
- `backups/` si se desea conservar el histórico de respaldos;
- `exports/` si existen salidas operacionales que deban mantenerse.

El comando de restauración SQLite no restaura automáticamente esas carpetas.

## 5. Datos privados

No copie datos reales mediante Git.

Las rutas operativas son:

```text
imports/    planilla maestra local
data/       base SQLite local
backups/    respaldos SQLite
evidence/   fotografías/evidencias
exports/    salidas con información operacional
local-certs/ certificados HTTPS locales
```

Todas deben permanecer fuera del repositorio.

Verifique:

```powershell
git check-ignore -v imports/
git check-ignore -v data/
git check-ignore -v backups/
git check-ignore -v evidence/
git check-ignore -v exports/
git check-ignore -v local-certs/
```

Consulte [DATOS-PRIVADOS.md](DATOS-PRIVADOS.md).

## 6. Configurar HTTPS local

El sistema funciona con HTTP local, pero el proyecto mantiene soporte HTTPS local para el terminal móvil y la evidencia fotográfica.

Vista previa:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-https.ps1
```

Creación confirmada:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-https.ps1 `
  -ConfirmCertificateCreation `
  -InstallLocalCA
```

Los certificados se guardan en `local-certs/` y nunca se publican ni se trasladan como parte del paquete de datos. Genérelos de nuevo en el equipo destino.

Consulte [HTTPS-CAMARA.md](HTTPS-CAMARA.md). Aunque el nombre del documento es histórico, la cámara se utiliza actualmente sólo para **evidencia fotográfica**, no para leer códigos.

## 7. Verificación integral

Con datos y certificados ya preparados, inicie el sistema mediante doble clic en:

```text
Iniciar Inventario Terreno.cmd
```

Después ejecute en otra consola:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

La verificación completa espera comprobar:

- herramientas;
- Node 24;
- dependencias;
- pruebas generales y móviles;
- SQLite válida;
- protección Git;
- certificado HTTPS;
- HTTP/HTTPS local;
- HTTP/HTTPS desde una IPv4 privada del equipo.

## 8. Uso normal

La forma normal de iniciar y detener no requiere consola:

```text
Iniciar Inventario Terreno.cmd
Detener Inventario Terreno.cmd
```

El navegador principal utiliza:

```text
http://localhost:3180
```

El enlace móvil debe generarse desde la propia sesión. No reutilice ni documente tokens móviles.

## 9. Teléfono

El notebook y el teléfono deben estar en la misma red local autorizada.

Si el teléfono no conecta:

1. confirme que ambos estén en la misma Wi‑Fi/hotspot;
2. confirme la IP privada del notebook;
3. pruebe `/api/health` desde el teléfono;
4. desactive temporalmente VPN/WireGuard si está desviando la ruta local;
5. revise Firewall de Windows para redes privadas;
6. genere un enlace móvil nuevo.

El teléfono es auxiliar: si falla, la oficina puede terminarse desde el notebook.

## 10. Verificación de SQLite

Para una base restaurada:

```powershell
node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database('data/inventario.sqlite',{readonly:true,fileMustExist:true}); console.log(db.pragma('integrity_check',{simple:true})); db.close();"
```

Debe devolver:

```text
ok
```

## 11. Checklist de instalación

- [ ] Git instalado.
- [ ] Node.js 24.x instalado.
- [ ] Python disponible cuando `node-gyp` necesite compilar módulos nativos.
- [ ] Visual Studio Build Tools 2022 + Desktop development with C++ disponible cuando sea necesario.
- [ ] GitHub CLI disponible sólo si se usará autenticación mediante `gh`.
- [ ] Repositorio clonado.
- [ ] `npm.cmd ci` completado.
- [ ] `npm.cmd test` aprobado.
- [ ] `npm.cmd run test:mobile` aprobado.
- [ ] `git diff --check` aprobado.
- [ ] Elegido explícitamente `NUEVO` o `RESTAURAR`.
- [ ] Datos privados trasladados por separado.
- [ ] Evidencias trasladadas junto con su SQLite cuando corresponda.
- [ ] SQLite devuelve `integrity_check = ok`.
- [ ] HTTPS local configurado cuando corresponda.
- [ ] `Iniciar Inventario Terreno.cmd` funciona por doble clic.
- [ ] Notebook abre la aplicación.
- [ ] Teléfono conecta a una sesión de prueba.
- [ ] Respaldo inicial creado.

## 12. Siguiente lectura

- [OPERACION-TERRENO.md](OPERACION-TERRENO.md)
- [DATOS-PRIVADOS.md](DATOS-PRIVADOS.md)
- [RESPALDO-RESTAURACION.md](RESPALDO-RESTAURACION.md)
- [SOLUCION-PROBLEMAS.md](SOLUCION-PROBLEMAS.md)
- [HANDOVER.md](HANDOVER.md)
