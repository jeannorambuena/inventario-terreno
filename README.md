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

## Teléfono

El teléfono es un terminal auxiliar. Debe estar en la misma red privada que el notebook.

El servidor genera un enlace temporal asociado a la sesión. Si el teléfono falla, el notebook puede terminar la oficina por sí solo.

Una VPN/WireGuard puede impedir el acceso a la LAN aunque el servidor esté funcionando.

Consulte [docs/PRUEBA-MOVIL.md](docs/PRUEBA-MOVIL.md) y [docs/SOLUCION-PROBLEMAS.md](docs/SOLUCION-PROBLEMAS.md).

## Informes

Con el sistema en ejecución:

```text
http://localhost:3180/reports
```

La reportería incluye avance, incidencias, evidencia, resumen ejecutivo, cierre y pendientes de regularización.

La impresión/guardado PDF utiliza la impresión normal del navegador.

## Respaldos

SQLite:

```powershell
npm.cmd run backup
```

Cuando existen fotografías, un respaldo operacional completo debe conservar conjuntamente:

```text
SQLite + evidence/
```

Consulte [docs/RESPALDO-RESTAURACION.md](docs/RESPALDO-RESTAURACION.md).

## Pruebas y verificación

```powershell
npm.cmd test
npm.cmd run test:mobile
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

`verify.ps1` valida herramientas, dependencias, pruebas, base, protección Git, HTTPS y conectividad local/LAN en la configuración operativa completa.

## Estructura

```text
public/       interfaz notebook, móvil e informes
src/          servidor, API, SQLite, importación y dominio
tests/        pruebas con datos sintéticos
scripts/      preparación, verificación, HTTPS y launchers
docs/         documentación operativa y técnica
```

## Documentación

- [Instalación Windows](docs/INSTALACION-WINDOWS.md)
- [Formato de datos](docs/FORMATO-DATOS.md)
- [Datos privados](docs/DATOS-PRIVADOS.md)
- [Operación de terreno](docs/OPERACION-TERRENO.md)
- [Respaldo y restauración](docs/RESPALDO-RESTAURACION.md)
- [Solución de problemas](docs/SOLUCION-PROBLEMAS.md)
- [Handover](docs/HANDOVER.md)
- [Autoauditoría de terreno](docs/AUTOAUDITORIA-TERRENO.md)

## Reutilización

El proyecto no depende de una municipalidad, oficina o IP específica. Otra organización puede reutilizarlo preparando una planilla compatible y manteniendo la separación entre software y datos privados.

Antes de una utilización institucional, revise sus propias obligaciones de seguridad, protección de datos, inventario y conservación documental.
