# Recuperación ante desastre

## ESCENARIO

- notebook perdido;
- teléfono perdido;
- GitHub disponible;
- backup privado disponible.

Este es el procedimiento definitivo para robo, pérdida total o falla irrecuperable del notebook. GitHub recupera el software; el ZIP operacional privado recupera SQLite y las fotografías hasta el último respaldo verificado. No reimporte el maestro ni restaure sobre datos existentes.

## PASO 1 — Conseguir Windows 10/11

Use un equipo confiable, con espacio suficiente y actualizaciones de seguridad aplicadas.

## PASO 2 — Instalar Git

Instale Git para Windows y compruebe `git --version`.

## PASO 3 — Instalar Node.js 24

Instale Node.js 24.x y compruebe `node --version` y `npm.cmd --version`.

## PASO 4 — Instalar herramientas de compilación si son necesarias

Si `better-sqlite3` no dispone de binario compatible y `npm.cmd ci` informa `gyp ERR! find VS`, instale Microsoft Visual Studio Build Tools con **Desktop development with C++** y repita la instalación.

## PASO 5 — Clonar el software

```powershell
git clone https://github.com/jeannorambuena/inventario-terreno.git
cd .\inventario-terreno
git switch feature/field-ux-integrity
```

Mientras `main` siga atrasado respecto de producción, use explícitamente `feature/field-ux-integrity`. No asuma `main` hasta que exista una liberación formal.

## PASO 6 — Instalar dependencias

```powershell
npm.cmd ci
```

## PASO 7 — Validar el software sin datos reales

```powershell
npm.cmd test
npm.cmd run test:mobile
npm.cmd run release:check
```

No continúe si algún comando falla.

## PASO 8 — Descargar el respaldo privado

Descargue desde el almacenamiento privado autorizado:

```text
backup-XXXXXXXX.zip
backup-XXXXXXXX.zip.sha256.txt
```

No registre en el repositorio una URL privada del almacenamiento.

## PASO 9 — Verificar SHA-256 del ZIP

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\RECUPERACION\backup-XXXXXXXX.zip'
Get-Content -LiteralPath 'D:\RECUPERACION\backup-XXXXXXXX.zip.sha256.txt'
```

Las huellas deben coincidir exactamente. Si no coinciden, deténgase y obtenga otra copia.

## PASO 10 — Expandir el paquete

```powershell
Expand-Archive -LiteralPath 'D:\RECUPERACION\backup-XXXXXXXX.zip' `
  -DestinationPath 'D:\RECUPERACION\expandido'
```

El directorio expandido debe contener un único `backup-XXXXXXXX` con `inventario.sqlite`, `evidence/` y `manifest.json`.

## PASO 11 — Verificar el backup específico

```powershell
node .\src\database\operational-backup.js verify `
  'D:\RECUPERACION\expandido\backup-XXXXXXXX'
```

El resultado requerido es `RESPALDO VERIFICADO: PASS`.

## PASO 12 — Restaurar con protección contra sobrescritura

Desde la raíz clonada, que aún no debe contener datos operacionales:

```powershell
node .\src\database\operational-backup.js restore `
  'D:\RECUPERACION\expandido\backup-XXXXXXXX' `
  (Get-Location).Path `
  --confirm
```

El comando debe terminar en `RESTAURACION OPERACIONAL: PASS`. Se negará si `data\inventario.sqlite`, `data/` o `evidence/` ya contienen datos.

## PASO 13 — Verificar la instalación restaurada

```powershell
npm.cmd run verify:field
npm.cmd run backup:verify
```

Ejecute además `npm.cmd run recovery:drill -- --backup 'D:\RECUPERACION\expandido\backup-XXXXXXXX'` si necesita una verificación integral independiente en TEMP.

## PASO 14 — Iniciar Inventario Terreno

```text
Iniciar Inventario Terreno.cmd
```

## PASO 15 — Comprobar el servicio local

Abra:

```text
http://localhost:3180
```

## PASO 16 — Conectar un teléfono nuevo

El móvil es un terminal auxiliar. El `deviceId` local del teléfono perdido no es necesario para recuperar SQLite ni evidencias. El teléfono nuevo crea una identidad auxiliar nueva.

## PASO 17 — Generar un enlace móvil nuevo

Abra o reanude una sesión válida desde el notebook y genere un enlace/QR temporal nuevo. No reutilice pairing tokens del teléfono perdido; los tokens anteriores deben considerarse no recuperables y no confiables.

## PASO 18 — Comprobar la operación recuperada

Revise, sin crear datos de prueba reales:

- sesiones y avance;
- fotografías históricas;
- informes y conciliación;
- auditoría.

La evidencia ya confirmada vive en `evidence/` y en el backup operacional, no como estado indispensable del teléfono.

## PASO 19 — Crear un nuevo respaldo

Detenga el servicio y cree inmediatamente un respaldo del equipo restaurado:

```powershell
npm.cmd run verify:field
npm.cmd run backup:operational
npm.cmd run backup:verify
npm.cmd run backup:package
```

Custodie el ZIP y su archivo SHA fuera del notebook.

## RPO — Punto objetivo de recuperación

La máxima pérdida posible es la información registrada **después del último backup externo verificado**. Por ejemplo, si el último respaldo externo es de las 15:03 y la pérdida total ocurre a las 15:30, el riesgo máximo es el trabajo entre ambas horas. El backup local que desaparece con el notebook no reduce este riesgo: la copia debe estar efectivamente transferida y verificada en almacenamiento externo.

## RTO — Tiempo objetivo de recuperación

- Windows limpio: objetivo inicial de 60–120 minutos, según descarga e instalación de herramientas.
- Windows preparado con herramientas instaladas: objetivo de 20–45 minutos.

Son objetivos operacionales, no garantías rígidas. La velocidad del almacenamiento y de la red, los permisos y la disponibilidad de cuentas pueden extenderlos.

## Acceso a GitHub y almacenamiento externo

**CONTROL ORGANIZACIONAL / USUARIO.** La continuidad requiere poder entrar a GitHub y al almacenamiento externo desde otro equipo, usando métodos de recuperación que no dependan exclusivamente del teléfono perdido.

Nunca guarde en Git contraseñas, códigos 2FA, backup codes, recovery codes, claves, passkeys ni tokens. El software no solicita ni verifica esos secretos; su custodia y recuperación independiente son responsabilidad organizacional del usuario.
