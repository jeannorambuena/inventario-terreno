# Instalación en Windows desde GitHub

Esta guía permite reconstruir **Inventario Terreno** en un equipo Windows nuevo sin depender del historial de desarrollo ni de datos privados del equipo original.

> GitHub contiene el software. Las planillas, la base SQLite, fotografías, certificados y respaldos se trasladan por separado.

## 1. Requisitos

- Windows 10 u 11.
- Git.
- Node.js 24.x, con npm incluido.
- Windows PowerShell 5.1 o PowerShell 7.
- GitHub CLI (`gh`) si se utilizarán los scripts actuales de preparación/verificación o si el repositorio requiere autenticación mediante `gh`.
- `mkcert` para la verificación HTTPS completa y el uso móvil con certificado local confiable.
- Navegador moderno.

Compruebe:

```powershell
git --version
gh --version
node --version
npm.cmd --version
mkcert -version
```

Node debe ser 24.x.

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

Ejecute las pruebas antes de introducir datos reales:

```powershell
npm.cmd test
npm.cmd run test:mobile
```

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

Los certificados se guardan en `local-certs/` y nunca se publican.

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
- [ ] GitHub CLI disponible si se usarán los scripts actuales de preparación/verificación.
- [ ] Repositorio clonado.
- [ ] `npm.cmd ci` completado.
- [ ] `npm.cmd test` aprobado.
- [ ] `npm.cmd run test:mobile` aprobado.
- [ ] Elegido explícitamente `NUEVO` o `RESTAURAR`.
- [ ] Datos privados trasladados por separado.
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
