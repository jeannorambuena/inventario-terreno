# Handover del proyecto

## Componentes transferibles por Git

- Código en `src/`.
- Interfaces en `public/`.
- Pruebas sintéticas en `tests/`.
- Documentación en `docs/`.
- Scripts de Windows en `scripts/`.
- `package.json` y `package-lock.json`.

## Componentes que no viajan por Git

- `imports/ACTIVOS.xlsx` y cualquier planilla municipal.
- `data/inventario.sqlite` y otras bases.
- `backups/`.
- Fotografías, exportaciones, `.env`, certificados, claves y tokens.

El traspaso de datos debe realizarse por un canal autorizado separado. No adjunte datos reales a issues, commits, chats, capturas ni logs.

## Checklist de entrega

1. Ejecutar `npm.cmd test` y `npm.cmd run test:mobile`.
2. Ejecutar `npm.cmd run backup` en el equipo de origen.
3. Confirmar `git status --short` y `git check-ignore` para las rutas privadas.
4. Registrar la versión de Node.js, la rama y el hash del commit entregado.
5. Entregar por separado el respaldo autorizado, si corresponde.
6. En el equipo destino, elegir expresamente `RESTAURAR` y confirmar que no exista `data/inventario.sqlite`.
7. Ejecutar `scripts/verify.ps1` antes de operar.
8. Iniciar con `scripts/start.ps1` y comprobar HTTP local y LAN.

## Estado operativo esperado

- Node.js 24.x.
- Dependencias instaladas mediante `npm.cmd ci`.
- Suites general y móvil aprobadas.
- Servidor escuchando en `0.0.0.0:3180`.
- Acceso permitido solo desde localhost y redes privadas.
- SQLite local existente y respaldada, sin estar rastreada por Git.

Si una comprobación no coincide, informar el bloqueo y detenerse. No crear datos municipales de ejemplo ni reconstruir registros reales a partir de mensajes o capturas.
