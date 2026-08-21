# Operación de terreno: visita completa

## Principio

El maestro representa lo que debería existir. La sesión registra únicamente lo observado físicamente y nunca modifica el maestro. El objetivo es salir de la oficina con información suficiente para conciliar y regularizar después, sin depender de la memoria.

## Flujo normal

1. Inicie mediante `Iniciar Inventario Terreno.cmd` y escriba el identificador corto del operador.
2. Seleccione Dirección, Departamento y Sección e inicie o reanude la sesión abierta.
3. Para un bien correcto: escriba o pegue el código y pulse Enter. No se requiere otro paso.
4. Use los controles adicionales sólo ante ausencia, incidencia, hallazgo adicional, discrepancia o corrección.
5. El teléfono es auxiliar. Si falla, continúe toda la visita en el notebook.

Al consultar un código, la ficha muestra **Ubicación según maestro**. Si el bien pertenece administrativamente a otra sección, use **No registrar aquí / revisar en su sección** cuando sólo esté comprobando de quién es. Esa acción no crea observaciones ni incidencias. Registre **Otra ubicación** únicamente cuando el bien esté efectivamente presente en la oficina inspeccionada.

No se usa la cámara para leer códigos. La cámara sólo obtiene evidencia fotográfica tipificada y local.

## Resultados explícitos

- Pendiente: todavía no revisado; impide cerrar.
- Encontrado correctamente: fue visto y corresponde a la oficina.
- Encontrado con incidencia: fue visto y tiene una condición documentada.
- Encontrado en otra ubicación: fue visto fuera de su ubicación administrativa.
- No encontrado en terreno: fue buscado y no estaba durante la visita; no significa “perdido”.
- Hallazgo provisional: bien observado que no pudo asociarse al maestro; recibe automáticamente `PROV-S…`.

Desde la lista de pendientes, **No encontrado en terreno** evita volver a escribir el código. La acción requiere confirmación y puede corregirse o anularse mientras la sesión siga abierta.

## Incidencias y evidencia

Capture los campos estructurados que aparezcan. Un provisional exige descripción y punto físico; una discrepancia exige campo y valor observado; un incompleto exige componente faltante; reparación, préstamo o traslado exigen destino y base “informado” o “verificado”; “requiere revisión” exige motivo.

Una observación admite varias evidencias de bien completo, etiqueta, serie/modelo, daño o ubicación. El sistema conserva MIME, tamaño, ruta relativa y SHA-256. Si un archivo falta o fue alterado, el cierre queda bloqueado. Cuando una foto requerida realmente no pueda obtenerse, registre una excepción estructurada y auditada.

Corregir crea una versión nueva y conserva la anterior. Anular evidencia u observación no elimina el archivo ni el registro histórico. Las sesiones cerradas son inmutables.

## Antes de salir

Pulse **¿Puedo salir de esta oficina?**. El servidor es la autoridad y bloquea el cierre ante:

- bienes esperados sin resultado;
- coincidencias ambiguas sin resolver;
- provisionales o incidencias incompletos;
- discrepancias sin valor observado;
- evidencia requerida ausente, faltante o alterada;
- combinaciones contradictorias.

Abra cada bloqueador desde el checklist, corríjalo y vuelva a evaluar. Sólo cuando aparezca **LISTA PARA CERRAR**, revise el resumen, marque la confirmación y pulse **Finalizar revisión de esta oficina**.

## Conciliación y entrega a Activo Fijo

En `/reports`, seleccione Dirección, Departamento y Sección y abra **Conciliación**. El documento compara, sin sobrescribir:

- ubicación administrativa según maestro;
- ubicación observada durante la sesión;
- resultado físico, incidencias, evidencia y acción propuesta;
- hallazgos adicionales que no existen en el maestro.

Una propuesta como **regularizar ubicación**, **evaluar baja** o **revisar alta** es una lista de trabajo; no acredita propiedad ni ejecuta un acto administrativo. La pestaña **Regularizaciones** agrupa esas tareas. Use **Exportar CSV para activo fijo** para entregar datos tabulares y **Imprimir / Guardar PDF** para el informe formal. Una sesión abierta se marca claramente como borrador; la versión final corresponde a una sesión cerrada.

Al terminar, revise `/reports`, cree el respaldo de fin de jornada y detenga el servicio mediante `Detener Inventario Terreno.cmd`.
