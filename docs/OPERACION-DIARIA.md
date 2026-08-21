# Operación diaria — Inventario Terreno

## Propósito

Este procedimiento define el uso ordinario del sistema después de su aceptación. La prioridad es conservar continuidad, trazabilidad y capacidad de recuperación sin alterar manualmente los datos.

## 1. Inicio de jornada

Desde la raíz de la instalación local, antes de iniciar una visita:

```powershell
cd C:\RUTA\inventario-terreno
npm.cmd run verify:field
npm.cmd run backup:operational
npm.cmd run backup:verify
```

Los controles deben terminar en PASS.

Luego iniciar normalmente con:

```text
Iniciar Inventario Terreno.cmd
```

No es necesario ejecutar toda la suite de pruebas cada jornada normal; `pilot:preflight` se reserva para piloto, liberación o después de cambios de software.

## 2. Preparación de la visita

- Seleccionar la Dirección, Departamento y Sección correctos.
- Reanudar la sesión existente si corresponde.
- No crear una segunda sesión para resolver una duda sobre una sesión activa.
- Confirmar que notebook y teléfono, si se usa, estén en la misma red privada.

## 3. Levantamiento

El orden de trabajo es:

```text
REALIDAD → SOFTWARE
MAESTRO → REALIDAD
EXCEPCIONES
```

Caso normal:

```text
CÓDIGO → Enter → registrado → siguiente
```

No transformar el flujo correcto en un formulario largo.

## 4. Evidencia

La cámara del teléfono se usa como evidencia, no como lector de código.

Cuando una incidencia requiere fotografía:

- seleccionar el tipo correcto;
- fotografiar el elemento necesario;
- verificar que la aplicación confirmó el registro;
- no renombrar ni mover el archivo posteriormente.

Si la evidencia obligatoria realmente no puede obtenerse, utilizar únicamente la excepción estructurada prevista por el sistema.

## 5. Antes de abandonar una oficina

No marcar ausencias durante el primer barrido.

Después del barrido físico, conciliar pendientes y buscar dirigidamente. Luego ejecutar:

```text
¿Puedo salir de esta oficina?
```

Resolver todos los bloqueadores y cerrar sólo cuando el servidor indique **LISTA PARA CERRAR**.

## 6. Fin de jornada

Revisar `/reports` y confirmar que las sesiones trabajadas aparecen correctamente.

Detener el servicio:

```text
Detener Inventario Terreno.cmd
```

Crear y verificar el respaldo de cierre:

```powershell
npm.cmd run backup:operational
npm.cmd run backup:verify
npm.cmd run verify:field
```

## 7. Contingencia: falla del teléfono

Continuar desde el notebook. El teléfono es auxiliar y su falla no debe detener el levantamiento básico.

No cambiar arquitectura, instalar lectores alternativos ni resetear la sesión durante la visita.

## 8. Contingencia: falla de red local

- mantener abierta la sesión del notebook si el servidor sigue operativo;
- registrar desde el notebook;
- no abrir puertos hacia Internet;
- no modificar VPN o router automáticamente;
- recuperar la LAN y volver a emparejar el teléfono si es necesario.

## 9. Contingencia: aplicación o notebook se detiene

1. No borrar `data/` ni `evidence/`.
2. No reimportar el XLSX.
3. No crear una base nueva encima de la existente.
4. Reiniciar el servicio únicamente cuando el equipo esté estable.
5. Ejecutar `npm.cmd run verify:field`.
6. Reanudar la sesión existente.

Si la base no abre o la integridad falla, detener la operación y pasar al procedimiento de recuperación.

## 10. Recuperación desde respaldo

Un respaldo operacional válido contiene:

```text
inventario.sqlite
evidence/
manifest.json
```

Primero verificar el respaldo:

```powershell
npm.cmd run backup:verify
```

Para verificar una ruta recibida:

```powershell
node .\src\database\operational-backup.js verify "D:\RESPALDOS\backup-XXXXXXXX"
```

La restauración no debe hacerse sobre una base existente ni combinar dos SQLite manualmente. Use el restaurador operacional descrito en [RESPALDO-RESTAURACION.md](RESPALDO-RESTAURACION.md). Para pérdida total del equipo siga [RECUPERACION-DESASTRE.md](RECUPERACION-DESASTRE.md).

El teléfono original no contiene estado indispensable para recuperar el sistema: las evidencias confirmadas viven en el respaldo. En un teléfono nuevo genere una identidad auxiliar y un enlace temporal nuevos; nunca reutilice tokens anteriores.

## 11. Acciones prohibidas durante operación normal

No:

- editar SQLite con herramientas externas;
- borrar registros para corregir errores;
- renumerar identificadores provisionales;
- reemplazar `ACTIVOS.xlsx` durante una jornada;
- copiar sólo fotos sin su base asociada como supuesto respaldo completo;
- versionar datos municipales en Git;
- usar `git add .` sin revisar el contenido.

## 12. Escalamiento

Si una prueba de integridad falla, una evidencia aparece alterada, existen dos bases divergentes o la sesión no puede reanudarse de forma coherente, detener el levantamiento de esa oficina y preservar el estado antes de intervenir.
