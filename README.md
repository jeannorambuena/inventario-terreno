# Inventario Terreno

Base segura para una aplicación local y offline de inventario en terreno para Windows. El objetivo futuro es consultar y gestionar una copia de trabajo del inventario sin alterar la fuente original `ACTIVOS.xlsx` y sin exponer información municipal.

## Estado actual

El repositorio contiene el MVP local, su API, interfaces de notebook y móvil, importación protegida, persistencia SQLite y pruebas automatizadas. Los datos operativos permanecen exclusivamente en el equipo local y fuera de Git.

El flujo de terreno oficial es **manual-first**: código + Enter registra inmediatamente un bien correcto. La cámara del teléfono se usa únicamente para evidencia fotográfica de incidencias; no existe lectura de códigos, OCR ni análisis de imagen.

Una oficina sólo puede cerrarse cuando cada bien esperado tiene un resultado explícito, las ambigüedades fueron resueltas y cada incidencia conserva el detalle y la evidencia requerida (o una excepción auditada). La pantalla **¿Puedo salir de esta oficina?** consulta esa validación al servidor; no modifica el maestro.

## Tecnología prevista

- Interfaz: HTML, CSS y JavaScript.
- Servidor local: Node.js 24 con JavaScript ES Modules y Express.
- Persistencia local: SQLite.
- Lectura de planillas: ExcelJS.
- Entorno objetivo: Windows, sin conexión requerida.

El equipo operativo de terreno es un notebook Dell personal con Windows. No se mantienen scripts de instalación o arranque para Linux.

El MVP no utiliza Docker, PHP, Java, lectores de código por cámara ni APIs de inteligencia artificial.

## Arquitectura resumida

```text
public/          Interfaz web estática local
    │
    ▼
src/             Servidor Express, dominio y acceso a datos
    ├── ExcelJS  Lectura de ACTIVOS.xlsx (solo lectura)
    └── SQLite   Copia de trabajo local no versionada

tests/           Pruebas con datos completamente sintéticos
docs/            Planificación y documentación técnica
```

La implementación futura separará la interfaz, las rutas HTTP, la lógica de dominio, la importación de Excel y la persistencia. Todos los códigos se tratarán como texto de extremo a extremo para preservar sus ceros iniciales.

## Seguridad de datos

`ACTIVOS.xlsx` es una fuente original de solo lectura y nunca debe incorporarse a Git. El `.gitignore` excluye planillas, CSV, bases de datos, fotografías, exportaciones, respaldos, certificados, claves, archivos `.env` y ubicaciones destinadas a datos municipales. No se deben usar datos municipales reales como ejemplos, fixtures o documentación.

## Estructura

```text
.
├── AGENTS.md
├── README.md
├── docs/
│   └── ROADMAP.md
├── public/
├── src/
└── tests/
```

## Instalación asistida por Codex en un nuevo equipo

En Windows, Codex debe leer `AGENTS.md` y seguir [docs/INSTALACION-NUEVO-EQUIPO.md](docs/INSTALACION-NUEVO-EQUIPO.md). El flujo comienza con una elección explícita entre `NUEVO` y `RESTAURAR`, instala dependencias reproducibles mediante `npm.cmd ci`, ejecuta ambas suites y verifica la protección de datos antes de iniciar:

```powershell
.\scripts\setup.ps1 -Mode NUEVO
.\scripts\setup-https.ps1
.\scripts\verify.ps1
.\scripts\start.ps1
```

Si la política local bloquea archivos `.ps1`, ejecútelos con `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`; el bypass se limita al proceso actual y no cambia la configuración global.

Para habilitar la cámara del Samsung mediante HTTPS local, instale `mkcert` de forma explícita y siga [docs/HTTPS-CAMARA.md](docs/HTTPS-CAMARA.md). Los certificados se crean solo con confirmación, quedan en `local-certs/` y nunca se publican. El servidor mantiene HTTP en `3180` y habilita HTTPS en `3443` cuando existen certificado y clave.

Para un traspaso, consulte también [docs/HANDOVER.md](docs/HANDOVER.md) y [docs/DATOS-LOCALES.md](docs/DATOS-LOCALES.md). Los scripts nunca eligen un modo, importan datos o sobrescriben una base existente de forma automática. Se exige respaldo antes y después de cada jornada y traslado separado con SHA-256 e integridad SQLite.

La guía de visita está en [docs/OPERACION-TERRENO.md](docs/OPERACION-TERRENO.md) y la última revisión automatizada en [docs/AUTOAUDITORIA-TERRENO.md](docs/AUTOAUDITORIA-TERRENO.md).
