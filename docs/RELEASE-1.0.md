# Release 1.0 — Criterios de congelamiento y liberación

## Estado de la candidata

La versión declarada es `1.0.0`. La rama `feature/field-ux-integrity` es la candidata de cierre hasta que el piloto real sea aceptado.

Durante esta etapa rige congelamiento funcional: no se agregan nuevas funciones de inventario. Sólo se aceptan correcciones demostradas por pruebas o por el piloto.

## 1. Comando de readiness

```powershell
npm.cmd run release:check
```

Comprueba, entre otros puntos:

- Node.js 24;
- versión `1.0.0`;
- comandos de prueba/integridad/respaldo;
- documentación de piloto, operación y release;
- exclusiones de datos privados;
- existencia y forma mínima del respaldo operacional más reciente.

Resultado requerido:

```text
RELEASE READINESS: PASS
```

## 2. Preflight completo

Antes del piloto y nuevamente antes de liberar:

```powershell
npm.cmd run pilot:preflight
```

Secuencia:

```text
npm test
→ verify:field
→ backup:operational
→ backup:verify
→ release:check
```

Ningún FAIL puede ignorarse para etiquetar v1.0.0.

Antes de una liberación formal también debe ejecutarse `npm.cmd run recovery:drill` sobre un respaldo operacional verificado. El procedimiento de pérdida total se mantiene en [RECUPERACION-DESASTRE.md](RECUPERACION-DESASTRE.md).

## 3. Checklist técnico

- [ ] Suite completa PASS.
- [ ] Integridad operacional PASS.
- [ ] Respaldo operacional creado.
- [ ] Respaldo verificado PASS.
- [ ] Release readiness PASS.
- [ ] `git diff --check` PASS.
- [ ] Sin datos municipales preparados para commit.
- [ ] Rama remota sincronizada.

## 4. Checklist funcional

- [ ] Flujo manual-first correcto.
- [ ] Cierre controlado por servidor.
- [ ] Hallazgos provisionales separados del universo maestro.
- [ ] Evidencias múltiples e integridad SHA-256.
- [ ] Correcciones/anulaciones conservan historial.
- [ ] Dashboard y explorador representan los totales correctos.
- [ ] Trazabilidad global disponible.
- [ ] Expediente de auditoría reproducible.
- [ ] Manifiesto JSON descargable.
- [ ] Exportación CSV e impresión verificadas.

## 5. Checklist humano del piloto

- [ ] Oficina piloto recorrida completamente.
- [ ] No fue necesario depender de memoria al salir.
- [ ] No se perdió evidencia.
- [ ] No se editaron datos manualmente fuera de la aplicación.
- [ ] Los pendientes reales bloquearon el cierre.
- [ ] La sesión cerrada quedó correctamente representada en informes.
- [ ] Respaldo posterior al piloto verificado.
- [ ] Defectos bloqueantes: 0.
- [ ] Defectos mayores abiertos: 0.

## 6. Protección de datos antes del commit final

Revisar:

```powershell
git status --short
git diff --check
git check-ignore data evidence backups imports exports local-certs
```

Nunca agregar:

```text
data/
evidence/
backups/
imports/
exports/
local-certs/
*.sqlite
XLS/XLSX reales
fotografías
tokens
certificados
```

## 7. Aceptación y merge

Sólo después de aceptar el piloto:

```text
feature/field-ux-integrity
→ revisión final
→ merge a main
→ tag v1.0.0
```

No hacer el merge únicamente porque las pruebas automatizadas pasan; la validación humana del piloto es parte del criterio de aceptación.

## 8. Etiquetado

Una vez fusionada la candidata aprobada en `main` y repetido el preflight final:

```powershell
git tag -a v1.0.0 -m "Inventario Terreno v1.0.0"
git push origin v1.0.0
```

Antes del tag verificar que `main` apunta exactamente al commit aprobado.

## 9. Después de v1.0.0

El uso real continúa progresivamente. Los cambios posteriores se clasifican como:

- corrección `1.0.x`;
- mejora compatible `1.x`;
- cambio incompatible futuro sólo con migración y procedimiento explícitos.

Los datos operacionales siguen siendo locales y privados; GitHub continúa almacenando únicamente software y documentación no sensible.
