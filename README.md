# Inventario Terreno

Base segura para una aplicación local y offline de inventario en terreno para Windows. El objetivo futuro es consultar y gestionar una copia de trabajo del inventario sin alterar la fuente original `ACTIVOS.xlsx` y sin exponer información municipal.

## Estado actual

Este repositorio contiene únicamente la estructura inicial y las reglas de seguridad. La aplicación y sus dependencias todavía no están implementadas ni instaladas.

## Tecnología prevista

- Interfaz: HTML, CSS y JavaScript.
- Servidor local: Node.js 24 con JavaScript ES Modules y Express.
- Persistencia local: SQLite.
- Lectura de planillas: ExcelJS.
- Entorno objetivo: Windows, sin conexión requerida.

El MVP no utilizará Docker, PHP, Java ni APIs de inteligencia artificial.

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

No hay comandos de instalación o ejecución todavía. Cuando el proyecto los incorpore, en Windows se deberá usar `npm.cmd` y `npx.cmd` si PowerShell bloquea `npm.ps1` o `npx.ps1`.
