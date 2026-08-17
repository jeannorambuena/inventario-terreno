# Solución de problemas

Guía práctica para fallas habituales de instalación y operación.

## Node.js no encontrado

Compruebe:

```powershell
node --version
```

Se requiere Node.js 24.x. Instálelo desde su fuente oficial y abra una consola nueva.

## npm no ejecuta en PowerShell

Use:

```powershell
npm.cmd --version
```

En este proyecto se recomienda `npm.cmd` para evitar bloqueos relacionados con `npm.ps1`.

## PowerShell bloquea scripts `.ps1`

Ejecute el script sólo para ese proceso:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

Esto no cambia la política global del equipo.

## `npm.cmd ci` falla

Compruebe primero:

```powershell
node --version
npm.cmd --version
git status --short
```

No borre `package-lock.json`. Si `node_modules` está inconsistente y no contiene datos propios, puede eliminarse y volver a ejecutar `npm.cmd ci`.

## Puerto 3180 o 3443 ocupado

Compruebe:

```powershell
Get-NetTCPConnection -LocalPort 3180 -State Listen
Get-NetTCPConnection -LocalPort 3443 -State Listen
```

Si el proceso corresponde a Inventario Terreno ya iniciado, utilice `Detener Inventario Terreno.cmd` antes de volver a iniciar.

No finalice procesos desconocidos sin identificarlos.

## El navegador no abre la aplicación

Pruebe:

```text
http://localhost:3180/api/health
```

Si no responde HTTP 200, reinicie mediante `Iniciar Inventario Terreno.cmd` y revise la ventana de error.

## El teléfono no conecta

Compruebe en este orden:

1. notebook y teléfono en la misma LAN privada;
2. enlace móvil nuevo generado desde una sesión abierta;
3. IP privada correcta del notebook;
4. Firewall de Windows permitido sólo en red privada;
5. VPN/WireGuard desactivado temporalmente si desvía la red local;
6. certificado HTTPS confiable cuando se utilice HTTPS.

El teléfono no es obligatorio para terminar una oficina: continúe desde el notebook si es necesario.

## Token móvil expirado o revocado

Genere un enlace móvil nuevo desde la sesión.

No intente editar ni reutilizar manualmente el token anterior.

## La base SQLite no existe

Debe elegir explícitamente una de estas operaciones:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Mode NUEVO
```

o:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Mode RESTAURAR
```

Consulte [INSTALACION-WINDOWS.md](INSTALACION-WINDOWS.md).

## SQLite falla integridad

Detenga el servidor y no siga registrando datos.

Ejecute una comprobación de sólo lectura sobre una copia o respaldo autorizado. Si `integrity_check` no devuelve `ok`, no sobrescriba el archivo original.

## Una fotografía aparece como no disponible

No copie o renombre manualmente archivos dentro de `evidence/`.

Compruebe que el respaldo/restauración incluyó la estructura de evidencia. El sistema también puede detectar archivos ausentes o alterados mediante sus metadatos de integridad.

## Fotografía demasiado grande o formato rechazado

Use JPEG, PNG o WebP dentro del límite aceptado por la aplicación. Si el teléfono genera un formato no compatible, configure la cámara para un formato estándar o capture nuevamente desde el selector ofrecido por la aplicación.

## Ya existe una sesión abierta

Reanude la sesión existente. El sistema evita crear sesiones abiertas duplicadas para la misma ubicación.

## No puedo cerrar una oficina

Abra **¿Puedo salir de esta oficina?**.

El servidor puede bloquear el cierre por:

- bienes pendientes;
- ambigüedades;
- provisionales incompletos;
- discrepancias sin valores observados suficientes;
- evidencia requerida ausente o alterada;
- incidencia inválida.

Resuelva los elementos indicados; no fuerce cambios directamente en SQLite.

## El sistema indica “No encontrado en terreno”

Este estado significa que el bien fue buscado y no estaba durante la visita. No significa automáticamente perdido, dado de baja ni eliminado del maestro.

## La IP del notebook cambió

Vuelva a comprobar la red. Si el certificado HTTPS local no incluye la IP nueva, regenérelo mediante `scripts/setup-https.ps1` con confirmación explícita.

## VPN/WireGuard

Una VPN puede capturar la ruta hacia la LAN y hacer que el enlace móvil parezca caído aunque el servidor funcione.

Para diagnosticar, desconecte temporalmente la VPN y pruebe de nuevo. No cambie automáticamente configuraciones VPN desde Inventario Terreno.

## `verify.ps1` falla por `mkcert` o HTTPS

La verificación integral actual considera HTTPS parte de la preparación operativa completa. Configure `mkcert` y los certificados según [HTTPS-CAMARA.md](HTTPS-CAMARA.md), luego repita `verify.ps1`.

## Datos privados aparecen en `git status`

No ejecute `git add .`.

Compruebe `.gitignore` y `git check-ignore`. Los datos privados no deben entrar al historial Git.
