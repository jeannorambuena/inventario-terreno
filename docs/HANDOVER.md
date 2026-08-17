# Handover entre el Dell de terreno y el equipo principal

## Alcance

El Dell personal con Windows es el equipo de operación en terreno. El HP 240 G6 con Linux Mint queda fuera del flujo y no requiere scripts Bash ni documentación operativa.

## Lo que viaja por Git

- Código en `src/` y `public/`.
- Pruebas sintéticas en `tests/`.
- Documentación en `docs/`.
- Scripts PowerShell en `scripts/`.
- Manifiestos npm.

## Lo que nunca viaja por Git

- `imports/ACTIVOS.xlsx` u otras planillas.
- `data/inventario.sqlite` y bases derivadas.
- `backups/`.
- `local-certs/`, certificados, claves y la CA de `mkcert`.
- Fotografías, exportaciones, `.env`, tokens y datos administrativos.

Los datos y certificados se trasladan únicamente por canales autorizados separados. La clave privada de la CA (`rootCA-key.pem`) nunca sale del Dell.

## Entrega inicial al Dell

1. Clonar el commit validado desde GitHub.
2. Confirmar Node.js 24 y ejecutar `npm.cmd ci`.
3. Ejecutar suites general y móvil.
4. Elegir explícitamente `NUEVO` o `RESTAURAR`.
5. Transferir Excel o SQLite por separado y comparar SHA-256 en origen y destino.
6. Validar SQLite con `PRAGMA integrity_check` en modo lectura.
7. Configurar `mkcert`, certificado e instalación manual de la CA del Samsung.
8. Ejecutar `verify.ps1` y comprobar HTTP/HTTPS local y LAN.

Nunca copie una base sobre `data/inventario.sqlite` existente. Nunca importe Excel sobre una base restaurada.

## Inicio de jornada

1. Conectar Dell y Samsung a la Wi-Fi municipal autorizada o al hotspot de terreno.
2. Detectar la IP privada actual.
3. Si cambió, regenerar el certificado con confirmación explícita.
4. Ejecutar `npm.cmd test` y `npm.cmd run test:mobile`.
5. Ejecutar `npm.cmd run backup`.
6. Iniciar con `scripts/start.ps1`.
7. Comprobar `http://localhost:3180/api/health` y `https://IP:3443/api/health`.

El ingreso de códigos es exclusivamente manual-first (código + Enter). La cámara se utiliza sólo para evidencia fotográfica de incidencias y nunca analiza códigos.

## Cierre de jornada y retorno de resultados

1. Abrir **¿Puedo salir de esta oficina?**, resolver todos los bloqueadores y finalizar las sesiones desde la aplicación; no editar SQLite manualmente.
2. Detener el servidor de forma controlada.
3. Ejecutar un respaldo final con `npm.cmd run backup`.
4. Calcular SHA-256 del respaldo y registrar solo metadatos seguros.
5. Copiar el respaldo a un medio autorizado y cifrado.
6. En el equipo principal, verificar nuevamente SHA-256 e integridad SQLite.
7. Guardar el respaldo recibido como archivo separado y de solo lectura.
8. No reemplazar ni fusionar automáticamente la base principal. Cualquier consolidación requiere autorización y un procedimiento específico.
9. Confirmar recepción antes de retirar el medio temporal.

## Certificados y Samsung

- La CA se instala manualmente según `docs/HTTPS-CAMARA.md`.
- Si cambia la IP del Dell, regenere el certificado; normalmente la misma CA sigue siendo válida.
- Al terminar el operativo, retire manualmente la CA del Samsung y elimine la copia temporal de `rootCA.pem`.
- Nunca copie la CA o certificados dentro del repositorio, respaldos de inventario o documentación.

## Evidencia de entrega

Registre de forma separada y sin datos municipales:

- hash del commit de código;
- versión de Node.js;
- resultado de pruebas;
- SHA-256 y fecha del respaldo transferido;
- resultado de `PRAGMA integrity_check`;
- confirmación de retiro de la CA cuando corresponda.

Ante cualquier diferencia de hash, fallo de integridad, conflicto de base existente o duda de autorización, deténgase sin reemplazar archivos.
