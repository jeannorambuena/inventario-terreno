# Aceptación del piloto — Inventario Terreno 1.0

## Objetivo

El piloto valida el producto completo en una oficina real antes de fusionar la rama de cierre a `main`. No busca agregar funciones nuevas: busca demostrar que el flujo físico, la trazabilidad, el cierre, la reportería y la recuperación operan juntos sin pérdida de información.

## Regla de seguridad

El piloto nunca debe resetear, reimportar ni sobrescribir la base existente. Si existe una sesión real abierta, debe preservarse. Sólo se reanuda si esa misma oficina fue expresamente definida como oficina piloto.

No borrar ni mover manualmente:

```text
data/
evidence/
backups/
imports/
```

## 1. Preflight obligatorio

Antes de salir a terreno, con el servidor detenido y desde la raíz del proyecto:

```powershell
npm.cmd run pilot:preflight
```

El comando debe completar, en este orden:

```text
pruebas automatizadas
→ integridad operacional
→ nuevo respaldo operacional
→ verificación independiente del respaldo
→ release readiness
```

Resultado final requerido:

```text
RELEASE READINESS: PASS
```

Si cualquier etapa falla, el piloto no comienza hasta diagnosticar el fallo. No aplicar resets como mecanismo de corrección.

## 2. Preparación de la oficina

Registrar antes de comenzar:

- fecha;
- operador;
- Dirección, Departamento y Sección;
- equipo notebook utilizado;
- teléfono auxiliar, si se utilizará;
- existencia de una sesión previa de esa oficina.

Confirmar que el maestro correcto está cargado y que la oficina seleccionada coincide con el lugar físico.

## 3. Barrido físico inicial

Recorrer físicamente la oficina antes de declarar ausencias definitivas.

Orden operacional:

```text
REALIDAD → SOFTWARE
MAESTRO → REALIDAD
EXCEPCIONES
```

Por cada objeto:

```text
OBJETO
→ ¿tiene código?
→ ¿existe en maestro?
→ ¿ubicación coincide?
→ estado físico
→ funcionamiento
→ ¿incidencia?
→ evidencia si corresponde
→ registrar
```

El caso normal debe continuar siendo:

```text
CÓDIGO → Enter → registrado → siguiente
```

## 4. Casos que el piloto debe cubrir

Como mínimo, validar los casos que existan realmente durante la visita:

- bien maestro encontrado correctamente;
- bien con incidencia;
- bien encontrado en otra ubicación;
- bien con dato distinto;
- hallazgo físico adicional/provisional;
- evidencia fotográfica tipificada;
- corrección o anulación, sólo si ocurre un error real de captura;
- bien no encontrado, únicamente después del barrido y búsqueda dirigida.

No inventar una incidencia sobre un bien real sólo para probar una pantalla. Los casos inexistentes se consideran cubiertos por pruebas automatizadas.

## 5. Regla para no encontrados

`No encontrado en terreno` se registra sólo después de:

```text
barrido completo
+
búsqueda dirigida
+
revisión del entorno inmediato
+
consulta a personal cuando corresponda
```

No significa extravío ni pérdida administrativa; significa que el bien no fue ubicado durante esa inspección.

## 6. Hallazgos provisionales

Un objeto físico adicional es un solo hallazgo aunque tenga varias incidencias.

Ejemplo:

```text
PROV-S1-0003
+ sin etiqueta
+ estado regular
+ requiere revisión
+ bien no registrado
= 1 hallazgo físico adicional
```

Nunca debe aumentar `bienesEsperadosRevisados`.

## 7. Cierre de oficina

Antes de salir, ejecutar **¿Puedo salir de esta oficina?**.

El cierre debe permanecer bloqueado si existe cualquiera de estas condiciones:

- bienes esperados pendientes;
- ambigüedades sin resolver;
- provisionales incompletos;
- discrepancias insuficientemente documentadas;
- evidencia requerida ausente o alterada;
- incidencias estructuralmente inválidas.

Sólo cuando el servidor indique **LISTA PARA CERRAR** se revisa el resumen y se finaliza la oficina.

## 8. Validación posterior al cierre

Comprobar en `/reports`:

1. Dashboard municipal.
2. Dirección / Departamento / Sección correctos.
3. Totales maestros separados de hallazgos físicos adicionales.
4. Incidencias visibles.
5. Evidencias accesibles.
6. Trazabilidad e historial.
7. Expediente de auditoría.
8. SHA-256 del expediente.
9. Exportación CSV.
10. Impresión / guardado PDF.
11. Descarga del manifiesto JSON.
12. Pestaña **Conciliación**: ubicación maestra y observada en columnas separadas.
13. Bien de otra sección presente: conserva su ubicación maestra y muestra la oficina observada.
14. Hallazgo adicional: aparece separado y no aumenta los bienes esperados.
15. Pestaña **Regularizaciones**: tareas agrupadas sin modificación automática del maestro.
16. CSV de conciliación abierto como datos, sin ejecución de fórmulas provenientes de texto capturado.

## 9. Respaldo de cierre del piloto

Concluida la oficina:

```powershell
npm.cmd run backup:operational
npm.cmd run backup:verify
npm.cmd run release:check
```

Los tres deben finalizar en PASS.

## 10. Criterios de aceptación

El piloto se acepta sólo si:

- no se perdió ningún registro capturado;
- el flujo normal fue suficientemente rápido para terreno;
- los hallazgos adicionales no contaminaron el universo maestro;
- el cierre bloqueó correctamente los pendientes;
- la reportería representó la realidad observada;
- las evidencias siguieron accesibles e íntegras;
- el expediente y su manifiesto se generaron;
- el respaldo operacional fue verificable;
- no fue necesario modificar manualmente SQLite ni archivos de evidencia.

## 11. Tratamiento de defectos

Después del piloto sólo se corrigen defectos demostrados por el piloto.

Clasificación:

- **Bloqueante:** riesgo de pérdida de datos, corrupción, cierre incorrecto o imposibilidad de continuar.
- **Mayor:** flujo importante incorrecto, pero sin pérdida de datos.
- **Menor:** presentación, texto o ergonomía sin riesgo para el registro.

Cada corrección debe repetir pruebas, integridad, respaldo y verificación antes de continuar hacia Release 1.0.
