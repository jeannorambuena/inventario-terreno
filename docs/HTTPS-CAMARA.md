# HTTPS local y cámara del Samsung

La cámara del navegador requiere un contexto seguro. `http://IP_DEL_DELL:3180` mantiene disponible la entrada manual, pero normalmente no habilita `getUserMedia`. Para cámara se usa `https://IP_DEL_DELL:3443` con un certificado local creado por `mkcert`.

## Principios de seguridad

- `mkcert`, la CA, el certificado y la clave son locales; nunca se publican en Git.
- `local-certs/` está ignorado y contiene únicamente el certificado hoja y su clave.
- El script no copia la CA al repositorio ni la instala en el Samsung.
- No se configura redirección de puertos ni exposición a Internet.
- La aplicación no captura, conserva ni transmite fotografías.
- La entrada manual continúa disponible si la cámara falla.

## Instalar mkcert en Windows

Compruebe primero:

```powershell
mkcert -version
```

Si falta, instálelo explícitamente desde una fuente oficial. Opciones habituales:

```powershell
winget install FiloSottile.mkcert
# O, si Chocolatey ya es el gestor autorizado del equipo:
choco install mkcert
```

Revise origen, versión y permisos antes de aceptar. Ningún script del proyecto instala `mkcert` silenciosamente.

## Crear el certificado

Conecte primero el Dell a la red que se usará y compruebe su IPv4 privada:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '10.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.' }
```

Vista previa, sin crear archivos:

```powershell
.\scripts\setup-https.ps1
```

Creación confirmada para `localhost`, `127.0.0.1` y las IP LAN detectadas:

```powershell
.\scripts\setup-https.ps1 -ConfirmCertificateCreation -InstallLocalCA
```

Para incorporar además la IP prevista de otra red privada, por ejemplo un hotspot:

```powershell
.\scripts\setup-https.ps1 -AdditionalIp '192.168.50.20' -ConfirmCertificateCreation -InstallLocalCA
```

`-InstallLocalCA` es una autorización explícita para confiar en la CA solamente en el Dell. Si ya estaba instalada, puede omitirse. Si los certificados existen, el script se detiene; solo puede reemplazarlos añadiendo `-ConfirmOverwrite` conscientemente.

El script se niega a trabajar si 3180 o 3443 están ocupados. Nunca lee, importa, borra ni reemplaza Excel o SQLite.

## Instalar manualmente la CA en el Samsung

1. En el Dell, ejecute `mkcert -CAROOT` para identificar el directorio privado de la CA.
2. Localice `rootCA.pem` fuera del repositorio. No copie `rootCA-key.pem`: la clave privada de la CA nunca debe salir del Dell.
3. Transfiera temporalmente solo `rootCA.pem` al Samsung mediante un medio autorizado y directo, no por Git, correo público ni nube personal.
4. En el Samsung, abra **Ajustes → Seguridad y privacidad → Más ajustes de seguridad → Instalar desde almacenamiento → Certificado de CA**. Los nombres pueden variar según la versión de Android.
5. Confirme la advertencia de Android y asigne un nombre reconocible, por ejemplo `Inventario Terreno Dell`.
6. Elimine del almacenamiento compartido del teléfono la copia temporal de `rootCA.pem` después de instalarla.
7. Abra la URL `https://IP_DEL_DELL:3443/mobile` y confirme que el navegador no muestra una advertencia TLS.

La instalación en el teléfono siempre es manual. Políticas corporativas, versiones de Android o navegadores específicos pueden impedir confiar en CA de usuario; en ese caso se mantiene la entrada manual.

## Retirar la CA del Samsung

Al finalizar definitivamente las pruebas o el uso del equipo:

1. Abra **Ajustes → Seguridad y privacidad → Más ajustes de seguridad → Credenciales de usuario** o **Certificados instalados**.
2. Seleccione `Inventario Terreno Dell`.
3. Pulse **Quitar** o **Eliminar** y confirme.
4. Compruebe que la URL HTTPS ya no sea confiable.
5. Elimine cualquier copia restante de `rootCA.pem` en Descargas, Mis archivos o el medio de transferencia.

## Arranque y URLs

Con certificado y clave presentes:

```powershell
.\scripts\start.ps1
```

El script muestra claramente:

- `http://localhost:3180` y `http://IP:3180` para operación manual;
- `https://localhost:3443` y `https://IP:3443` para cámara y operación segura.

## Wi-Fi de una unidad municipal

1. Conecte Dell y Samsung a la misma Wi-Fi autorizada.
2. Configure el perfil de Windows como red privada solo si la política institucional lo permite.
3. Permita Node.js en Firewall de Windows únicamente para redes privadas.
4. Detecte la IP, regenere el certificado si no está incluida y ejecute `verify.ps1`.
5. Si la red aplica aislamiento entre clientes, el Samsung no podrá alcanzar el Dell. No eluda esa política: use un hotspot autorizado o entrada manual.

## Hotspot en terreno

1. Active el hotspot autorizado y conecte Dell y Samsung a él.
2. Detecte la nueva IP privada del Dell.
3. Si cambió, detenga el servidor y regenere el certificado con esa IP mediante `-AdditionalIp` y confirmación explícita.
4. Reinicie y use la URL HTTPS mostrada.
5. Nunca exponga 3180 o 3443 mediante redirección de puertos o túneles públicos.

## Regeneración por cambio de IP

Los certificados validan nombres e IP concretos. Cuando la IP LAN cambie:

```powershell
.\scripts\setup-https.ps1 -AdditionalIp 'NUEVA_IP_PRIVADA' -ConfirmCertificateCreation -ConfirmOverwrite
.\scripts\verify.ps1
```

La CA puede permanecer igual; normalmente no es necesario reinstalarla en el Samsung. Confirme siempre que la nueva IP sea privada y que ambos dispositivos estén en la misma red.

## Diagnóstico de cámara

- **HTTP por IP:** la interfaz explica que el contexto no es seguro y mantiene la entrada manual.
- **Permiso denegado:** habilite Cámara para el navegador desde Ajustes del Samsung.
- **Lector no compatible:** pruebe un navegador actualizado o use entrada manual.
- **Advertencia TLS:** revise CA instalada, IP incluida en el certificado, fecha/hora y URL exacta.
- **Sin conexión:** compruebe red común, Firewall de Windows y aislamiento de clientes.
