# Autoauditoría operacional para salida a terreno

Fecha de revisión técnica: 2026-08-17. Alcance: lógica, API, SQLite sintética, notebook, móvil, reportería, seguridad local, lanzadores y pruebas automatizadas. No sustituye la validación física con el Dell y el Samsung.

## Resultado automatizado

- Cierre prematuro: bloqueado por autoridad del servidor.
- Resultados explícitos: todo esperado debe quedar encontrado, con incidencia, en otra ubicación o no encontrado.
- Provisionales: identificador de servidor, descripción, punto físico y evidencia obligatoria.
- Discrepancias: campo, maestro y valor observado, o lectura posterior respaldada por evidencia.
- Evidencia: relación múltiple, tipos, ruta relativa, MIME, tamaño, SHA-256, detección de ausencia/alteración y excepción auditada.
- Ambigüedades: selección individual por `assetId`; un candidato observado no bloquea otro.
- Correcciones: versiones activas, antes/después, motivo, operador, dispositivo y auditoría.
- Integridad: índices SQLite parciales impiden duplicados activos por sesión+activo y sesión+provisional.
- Red: administración limitada a loopback; la LAN sólo recibe salud, recursos móviles y API móvil con token temporal.
- Operación: el caso normal continúa siendo código + Enter; el notebook puede completar la visita sin teléfono.

La simulación sintética cubre 50 esperados, 35 correctos inicialmente, 4 no encontrados, 3 de otra ubicación, 2 no registrados y las condiciones mínimas solicitadas. Incluye doble envío, desconexión/reconexión, ambigüedad, corrección, múltiples fotografías, archivo faltante, hash alterado, cierre rechazado y cierre válido con 0 pendientes. Las listas de 50, 200 y 500 bienes se consultan sin alterar integridad.

## Riesgos restantes

### Importante

- `npm audit --omit=dev` informa una vulnerabilidad moderada transitiva de `uuid` a través de ExcelJS. La corrección automática ofrecida degrada ExcelJS a una versión mayor incompatible; no se aplicó `--force`. El XLSX es una fuente local confiable y de solo lectura, por lo que se acepta temporalmente y debe reevaluarse cuando ExcelJS publique una actualización compatible.

### Mejora

- La interfaz usa HTML/DOM directo y no virtualiza listas. Se evita reconstruirlas durante polling cuando la firma no cambia; la prueba sintética de 500 elementos es satisfactoria.
- La seguridad LAN es proporcional al servicio local, no un sistema empresarial de identidades. Operar en hotspot privado o red municipal expresamente autorizada, sin redirección de puertos.

### No necesario en este alcance

- OCR, lector de códigos por cámara, ZXing, `BarcodeDetector`, IA, nube, GPS, WebSockets y modo móvil offline complejo.

## Validación física pendiente

Ejecutar en el Dell/Samsung el checklist corto entregado con la versión candidata. Ninguna prueba automatizada declara haber validado permisos físicos, ergonomía real, conectividad del recinto ni calidad de las fotografías.
