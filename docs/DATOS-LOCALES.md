# Datos locales y privados

## Rutas

- `imports/`: fuentes Excel locales. `imports/ACTIVOS.xlsx` se trata como solo lectura.
- `data/`: base de operación SQLite. La ruta predeterminada es `data/inventario.sqlite`.
- `backups/`: respaldos operacionales creados con `npm.cmd run backup:operational` y paquetes externos ignorados por Git.

Las tres rutas están excluidas de Git y no deben publicarse.

## Modo NUEVO

Se usa cuando el equipo no tiene una base local. Una importación requiere autorización explícita y una fuente XLSX identificada. Antes de importar:

1. Confirmar que no exista `data/inventario.sqlite`.
2. Confirmar que no exista `imports/ACTIVOS.xlsx` o detenerse para evitar sobrescritura.
3. Conservar la fuente original fuera del repositorio y copiarla solo a la ruta privada autorizada.
4. Ejecutar la importación una sola vez.
5. Ejecutar un respaldo inmediatamente después.

## Modo RESTAURAR

Se usa para trasladar una base autorizada. Antes de restaurar:

1. Confirmar que el equipo destino no tenga `data/inventario.sqlite`.
2. Verificar que la fuente sea un archivo SQLite y que provenga del canal autorizado.
3. Copiar sin sobrescribir.
4. Abrirla en modo de verificación, ejecutar las pruebas y crear un respaldo local.

Nunca combine automáticamente dos bases ni reemplace una existente.

## Respaldos

```powershell
npm.cmd run backup:operational
npm.cmd run backup:verify
```

El mecanismo canónico crea una SQLite coherente, copia la evidencia referenciada y genera `manifest.json` en `backups/operational/`. No borra respaldos anteriores. `npm.cmd run backup` se conserva sólo como respaldo SQLite simple **LEGACY**. Revise espacio disponible y custodie los paquetes mediante el procedimiento municipal autorizado.

## Reglas permanentes

- No borrar sesiones u observaciones históricas.
- No editar SQLite con herramientas externas durante la operación.
- No guardar códigos como números; deben conservarse como texto.
- No imprimir tokens móviles ni datos administrativos en logs.
- No usar datos reales en pruebas automatizadas.
- Antes de preparar Git, comprobar que las rutas privadas siguen ignoradas.
