# Modo offline: Samsung ↔ notebook sin Internet

Esta guía describe el procedimiento de terreno cuando **no existe Wi‑Fi institucional ni acceso a Internet** y el teléfono Samsung debe comunicarse directamente con el notebook Windows que ejecuta Inventario Terreno.

La operación normal de Inventario Terreno es local: el servidor escucha en todas las interfaces del notebook (`0.0.0.0`), acepta clientes de IPv4 privadas y el terminal móvil usa un enlace temporal de sesión. Internet no participa en el registro de bienes, incidencias ni evidencias.

## Arquitectura recomendada

Usar el **Samsung como punto de acceso Wi‑Fi (hotspot)** y el notebook como cliente.

```text
              SIN INTERNET
                  X
                  |
          ┌────────────────┐
          │ Samsung        │
          │ Hotspot Wi‑Fi  │
          │ navegador      │
          └───────┬────────┘
                  │ Wi‑Fi local privada
                  │
          ┌───────┴────────┐
          │ Notebook       │
          │ Inventario     │
          │ Node + SQLite  │
          │ puerto 3180    │
          └────────────────┘
```

El Samsung crea la red privada y asigna una IP al notebook. El notebook ejecuta la aplicación. El mismo Samsung abre en su navegador el enlace móvil que apunta a la IP privada del notebook.

## Por qué este modo es el recomendado

- No depende de router, Wi‑Fi municipal ni Internet.
- No depende de datos móviles.
- El notebook ve la conexión como una interfaz Wi‑Fi física, que es la interfaz que Inventario Terreno prioriza para el enlace móvil.
- La aplicación funciona por HTTP local en el puerto `3180`; para esta topología no es necesario que el certificado HTTPS contenga la IP dinámica entregada por el hotspot.
- La evidencia fotográfica móvil usa el selector/cámara del teléfono mediante un campo de archivo; no depende de servicios externos.

## Preparación obligatoria antes de salir a terreno

Realizar una vez mientras todavía se dispone de Internet y tiempo de soporte.

1. Tener el repositorio y dependencias ya instalados.
2. Tener la base SQLite, `ACTIVOS.xlsx` y `evidence/` restaurados.
3. Ejecutar `scripts/verify.ps1` y obtener todos los controles en `PASS`.
4. Crear y verificar un respaldo operacional reciente.
5. Configurar en el Samsung un hotspot con nombre y clave conocidos.
6. Conectar el notebook al hotspot al menos una vez para que Windows guarde el perfil.
7. Marcar esa red como **Privada** en Windows, porque es una red personal controlada por el usuario.
8. Desactivar cualquier opción del Samsung que apague automáticamente el hotspot cuando no detecta tráfico, si está disponible.
9. Guardar esta guía localmente en el notebook. No depender de GitHub para leerla en terreno.

## Configuración recomendada del hotspot Samsung

Los nombres de los menús pueden variar según la versión de Android/One UI.

En el Samsung:

1. Abra **Ajustes**.
2. Entre a **Conexiones**.
3. Abra **Mobile Hotspot y Anclaje a red / Zona Wi‑Fi y anclaje**.
4. Active **Mobile Hotspot / Zona Wi‑Fi**.
5. Defina un nombre de red reconocible, por ejemplo `INVENTARIO-CAMPO`.
6. Use una contraseña robusta y conocida sólo por el operador.
7. Para máximo alcance y compatibilidad, prefiera banda **2,4 GHz** cuando el teléfono permita elegirla.
8. Si existe una opción de apagado automático del hotspot, desactívela durante la jornada de inventario.

### Para una prueba realmente sin Internet

Antes de activar el hotspot:

- desactive **Datos móviles** en el Samsung;
- desconecte el Samsung de cualquier Wi‑Fi con Internet;
- desconecte el notebook de cualquier otra conexión Ethernet/Wi‑Fi con Internet.

El hotspot seguirá utilizándose únicamente como red local entre los dos equipos.

## Procedimiento al llegar a una oficina sin Internet

### 1. Activar la red local

En el Samsung, active el hotspot `INVENTARIO-CAMPO`.

En el notebook, conéctese a esa red Wi‑Fi.

### 2. Confirmar que Windows considera la red privada

Abra PowerShell:

```powershell
Get-NetConnectionProfile |
Where-Object { $_.InterfaceAlias -match 'Wi-Fi|WLAN' } |
Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity
```

Si la red del Samsung aparece como `Public`, y confirma que es su hotspot personal, cámbiela a privada:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

Si el nombre de la interfaz no es `Wi-Fi`, use exactamente el valor mostrado en `InterfaceAlias`.

### 3. Obtener la IP del notebook en el hotspot

Ejecute:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
Where-Object {
  $_.IPAddress -like '10.*' -or
  $_.IPAddress -like '192.168.*' -or
  $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.'
} |
Select-Object InterfaceAlias,IPAddress
```

Identifique la IPv4 correspondiente a la interfaz Wi‑Fi conectada al Samsung.

Ejemplo solamente:

```text
InterfaceAlias  IPAddress
Wi-Fi           192.168.43.120
```

**No memorice el ejemplo. Use la IP que muestre su notebook ese día.**

### 4. Iniciar Inventario Terreno

Haga doble clic en:

```text
Iniciar Inventario Terreno.cmd
```

En el notebook, la administración continúa en:

```text
http://localhost:3180
```

### 5. Probar conectividad desde el Samsung

En el navegador del Samsung escriba:

```text
http://IP-DEL-NOTEBOOK:3180/api/health
```

Ejemplo solamente:

```text
http://192.168.43.120:3180/api/health
```

Debe aparecer:

```json
{"ok":true,"service":"inventario-terreno"}
```

Si este paso falla, **no comience la oficina todavía**. Consulte el diagnóstico al final de esta guía.

### 6. Abrir la sesión en el notebook

Desde `http://localhost:3180`:

1. seleccione la ubicación correcta;
2. abra o reanude la sesión de esa oficina;
3. genere un **enlace móvil nuevo**;
4. use el QR o copie la URL en el Samsung.

Los enlaces móviles son temporales. No reutilice un token de una sesión anterior.

### 7. Trabajar normalmente

- Notebook: control principal de la oficina.
- Samsung: terminal auxiliar de registro y evidencia.
- Caso normal: `CÓDIGO → Enter → registrado → siguiente`.
- Cámara: sólo para evidencia fotográfica de incidencias.
- Todo se guarda localmente en SQLite y `evidence/` del notebook.

No se necesita Internet durante esta operación.

## Prueba obligatoria antes de depender del modo offline

Realice esta prueba completa antes de la primera salida:

### Etapa A — aislar Internet

- Samsung: datos móviles OFF.
- Samsung: Wi‑Fi externo OFF/desconectado.
- Notebook: desconectado de Ethernet y de cualquier Wi‑Fi con Internet.
- Samsung: hotspot ON.
- Notebook: conectado únicamente al hotspot Samsung.

### Etapa B — comprobar red

1. Obtenga la IP Wi‑Fi del notebook.
2. Inicie Inventario Terreno.
3. Desde el Samsung abra `/api/health` por HTTP.
4. Confirme respuesta `200`/JSON `ok:true`.

### Etapa C — comprobar terminal móvil

1. Abra o reanude una sesión autorizada.
2. Genere un enlace móvil nuevo.
3. Abra el enlace en el Samsung.
4. Confirme que aparecen ubicación, avance y controles.
5. Realice una prueba operacional controlada sólo si dispone de una sesión/registro apto para pruebas.
6. Si corresponde probar evidencia, tome una foto de prueba y confirme que llega a `evidence/`.

No altere datos reales sólo para probar. Si se necesita una prueba destructiva, utilice una copia/sesión de prueba o un respaldo controlado.

## HTTPS en modo offline

La instalación normal puede tener HTTPS para la LAN habitual. Sin embargo, la IP que recibe el notebook desde el hotspot Samsung puede ser distinta y cambiar entre jornadas.

Para el modo de emergencia/offline recomendado, utilice el enlace móvil **HTTP local** generado por la aplicación:

```text
http://IP-DEL-NOTEBOOK:3180
```

No regenere certificados en terreno salvo que exista una necesidad específica y se comprenda el impacto. El certificado HTTPS creado para otra LAN no es válido automáticamente para una IP nueva del hotspot.

## Diagnóstico rápido si el Samsung no conecta

Siga este orden. No improvise cambios en SQLite.

### A. Confirmar que ambos están en la misma red

Notebook:

```powershell
Get-NetConnectionProfile
Get-NetIPAddress -AddressFamily IPv4
```

El notebook debe estar conectado al hotspot del Samsung.

### B. Confirmar que el servidor está vivo

Notebook:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3180/api/health |
Select-Object StatusCode,Content
```

Debe responder `200`.

### C. Confirmar que el puerto escucha en la red

```powershell
Get-NetTCPConnection -State Listen |
Where-Object { $_.LocalPort -eq 3180 } |
Select-Object LocalAddress,LocalPort,OwningProcess
```

La dirección esperada es `0.0.0.0:3180`.

### D. Confirmar perfil de red

```powershell
Get-NetConnectionProfile
```

La red controlada del Samsung debería estar marcada como `Private`.

### E. Probar desde el Samsung

Abra:

```text
http://IP-DEL-NOTEBOOK:3180/api/health
```

No use `localhost` en el Samsung. `localhost` en el teléfono significa **el propio teléfono**, no el notebook.

### F. VPN

Si existe una VPN/WireGuard activa en notebook o teléfono, desactívela temporalmente durante el diagnóstico porque puede desviar la ruta local.

### G. Reinicio mínimo

Si todo lo anterior es correcto pero no conecta:

1. detenga Inventario Terreno con `Detener Inventario Terreno.cmd`;
2. apague y vuelva a encender el hotspot Samsung;
3. reconecte el notebook;
4. confirme la nueva IP;
5. inicie Inventario Terreno;
6. genere un enlace móvil nuevo.

## Plan B: trabajar sólo desde el notebook

El teléfono es auxiliar. Si la comunicación Samsung ↔ notebook falla y no puede resolverse con rapidez, continúe el levantamiento desde la interfaz principal del notebook.

No abandone una oficina sólo porque el teléfono falló. La autoridad de cierre permanece en el servidor del notebook y la pantalla **¿Puedo salir de esta oficina?** debe indicar que no quedan bloqueos.

## Cierre de jornada offline

1. Termine o deje explícitamente abiertas las sesiones que correspondan.
2. Detenga la aplicación con `Detener Inventario Terreno.cmd`.
3. Cree un respaldo:

```powershell
cd C:\Users\<USUARIO>\Proyectos\inventario-terreno
npm.cmd run backup:operational
npm.cmd run backup:verify
```

4. El respaldo operacional ya reúne la SQLite, la evidencia referenciada y `manifest.json`.
5. Custodie fuera del notebook un paquete creado con `npm.cmd run backup:package`; no copie manualmente componentes separados como mecanismo principal.

```text
backup-XXXXXXXX.zip
backup-XXXXXXXX.zip.sha256.txt
```

6. No copie estos datos a GitHub.

## Checklist de bolsillo

```text
ANTES DE PARTIR
[ ] Aplicación verificada
[ ] Base presente
[ ] ACTIVOS.xlsx presente
[ ] Evidence presente
[ ] Respaldo reciente
[ ] Hotspot Samsung configurado
[ ] Notebook ya conoce la clave del hotspot
[ ] Esta guía está guardada localmente

EN LA OFICINA SIN INTERNET
[ ] Datos móviles Samsung OFF (si se desea aislamiento total)
[ ] Hotspot Samsung ON
[ ] Notebook conectado al hotspot
[ ] Red Windows = Private
[ ] Obtener IP Wi‑Fi del notebook
[ ] Iniciar Inventario Terreno
[ ] Samsung abre http://IP:3180/api/health
[ ] Abrir/reanudar sesión
[ ] Generar enlace móvil NUEVO
[ ] Trabajar
[ ] Antes de salir: ¿Puedo salir de esta oficina?

SI FALLA EL TELÉFONO
[ ] Confirmar hotspot
[ ] Confirmar IP
[ ] Confirmar localhost:3180/api/health en notebook
[ ] Confirmar 0.0.0.0:3180 escuchando
[ ] Confirmar red Private
[ ] Desactivar VPN temporalmente
[ ] Reiniciar hotspot y servidor
[ ] Si persiste: continuar desde notebook
```

## Regla operativa

**Internet es opcional. La red local entre Samsung y notebook es lo esencial.**

No dependa de GitHub, nube, router municipal ni datos móviles para terminar una oficina. Todo lo necesario para el levantamiento debe estar instalado y respaldado localmente antes de salir a terreno.
