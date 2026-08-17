# Inventario Terreno

Aplicación local para **levantar inventario físico en terreno, conciliarlo con un maestro y dejar trazabilidad suficiente para regularización posterior**.

El sistema está diseñado para trabajar desde un notebook Windows y, opcionalmente, un teléfono conectado a la misma red privada.

## Qué problema resuelve

Una base maestra indica lo que administrativamente debería existir. La visita de terreno registra lo que realmente se observa.

```text
MAESTRO
  ↓
VISITA DE TERRENO
  ↓
REALIDAD FÍSICA
  ↓
INCIDENCIAS + EVIDENCIA
  ↓
CONCILIACIÓN
  ↓
REGULARIZACIÓN
  ↓
INVENTARIO DE MURO CORRECTO
```

Inventario Terreno **no modifica automáticamente el maestro**.

## Estado

Versión funcional de producción manual-first.

El caso normal está optimizado para:

```text
CÓDIGO → Enter → registrado → siguiente
```

La cámara del teléfono se usa sólo para **evidencia fotográfica de incidencias**. No se usa OCR, ZXing ni lectura de códigos por cámara.

Una oficina no puede cerrarse normalmente mientras queden bienes pendientes, ambigüedades, provisionales incompletos, discrepancias insuficientemente documentadas o evidencia requerida faltante/alterada. La pantalla **¿Puedo salir de esta oficina?** consulta esa validación al servidor.

## Funciones principales

- Importación protegida desde XLSX.
- Jerarquía Dirección → Departamento → Sección.
- Sesiones de inventario por ubicación.
- Registro rápido manual-first.
- Estado explícito `No encontrado en terreno`.
- Bienes adicionales con identificador provisional generado por servidor.
- Incidencias estructuradas.
- Discrepancias con valor maestro y valor observado.
- Evidencia fotográfica múltiple y tipificada.
- Integridad de evidencia mediante metadatos y SHA-256.
- Correcciones y anulaciones auditadas.
- Resolución de códigos ambiguos.
- Terminal móvil sincronizado con token temporal.
- Cierre de oficina controlado por servidor.
- Informes de avance, incidencias, cierre y regularización.
- Inicio y detención mediante doble clic en Windows.

## Tecnología

- Node.js 24.x.
- Express 5.
- SQLite (`better-sqlite3`).
- ExcelJS.
- HTML, CSS y JavaScript ES Modules.
- Vitest y Supertest para pruebas.
- PowerShell para instalación/verificación local en Windows.

No requiere Docker, nube, servicios de IA ni conexión a Internet durante la operación normal.

## Requisitos de instalación en Windows

Para reconstruir el proyecto desde GitHub se requiere:

- Windows 10 u 11.
- Git.
- Node.js 24.x con npm.
- PowerShell 5.1 o PowerShell 7.
- Python 3 disponible para `node-gyp` cuando una dependencia nativa deba compilarse.
- Visual Studio Build Tools 2022 con **Desktop development with C++** cuando `better-sqlite3` no disponga de un binario precompilado compatible.

En una instalación limpia real de Windows con Node.js 24 se comprobó que `npm.cmd ci` necesitó compilar `better-sqlite3`. El requisito C++ se resolvió con:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
  --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
  --accept-package-agreements `
  --accept-source-agreements
```

Para confirmar que el compilador x64/x86 quedó instalado:

```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

Consulte [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md) y [docs/SOLUCION-PROBLEMAS.md](docs/SOLUCION-PROBLEMAS.md) antes de una instalación nueva.

## Inicio rápido en Windows

### 1. Clonar

```powershell
git clone https://github.com/jeannorambuena/inventario-terreno.git
cd inventario-terreno
```

Para un repositorio privado también puede autenticarse con GitHub CLI:

```powershell
gh auth login
gh repo clone jeannorambuena/inventario-terreno
cd inventario-terreno
```

### 2. Instalar dependencias

```powershell
npm.cmd ci
```

Si aparece `gyp ERR! find VS`, no ejecute `npm audit fix` ni modifique `package-lock.json`: instale los Build Tools C++ indicados arriba y repita `npm.cmd ci`.

### 3. Ejecutar pruebas

```powershell
npm.cmd test
npm.cmd run test:mobile
```

### 4. Preparar los datos

Elija explícitamente:

- **NUEVO**: crear una SQLite desde una planilla XLSX autorizada.
- **RESTAURAR**: trasladar una SQLite existente.

Consulte [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md).

### 5. Iniciar

La operación normal se inicia con doble clic en:

```text
Iniciar Inventario Terreno.cmd
```

Para detener:

```text
Detener Inventario Terreno.cmd
```

La interfaz principal queda disponible en:

```text
http://localhost:3180
```

## Operación sin Internet

Inventario Terreno puede trabajar sin Internet utilizando el **Samsung como hotspot Wi‑Fi local** y el notebook como cliente. El teléfono se conecta al servidor del notebook mediante una IPv4 privada y el enlace móvil temporal de la sesión.

Antes de depender de este modo en terreno, realice una prueba completa con datos móviles y Wi‑Fi externo desactivados.

Guía operativa y checklist de emergencia: [docs/MODO-OFFLINE-SAMSUNG.md](docs/MODO-OFFLINE-SAMSUNG.md).

## Datos privados

GitHub contiene el **software**, no los datos operacionales.

Nunca se versionan:

```text
imports/
data/
backups/
evidence/
exports/
local-certs/
```

Tampoco planillas reales, SQLite, fotografías, certificados, claves, tokens o datos administrativos.

Consulte [docs/DATOS-PRIVADOS.md](docs/DATOS-PRIVADOS.md).

## Formato de planilla

La importación de referencia espera la hoja `BD_SQL` y las columnas principales:

```text
codigo_bien
bien
marca
serie
modelo
color
direccion
departamento
seccion
finbaja
codigo_escaner
```

Los códigos se conservan como texto para no perder ceros iniciales.

Consulte [docs/FORMATO-DATOS.md](docs/FORMATO-DATOS.md).

## Operación en terreno

Principio:

> No abandonar una oficina hasta que el sistema indique que el levantamiento contiene información suficiente para continuar la conciliación sin depender de la memoria.

Guía completa: [docs/OPERACION-TERRENO.md](docs/OPERACION-TERRENO.md).
