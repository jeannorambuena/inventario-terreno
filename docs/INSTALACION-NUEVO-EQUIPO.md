# Instalación en un nuevo equipo Windows

## Requisitos

- Windows 10 u 11.
- Git.
- GitHub CLI (`gh`) autenticado para clonar un repositorio privado.
- Node.js 24.x con npm.
- PowerShell 5.1 o PowerShell 7.
- Notebook y Samsung conectados a la misma red privada para la operación móvil.

En PowerShell se usan `npm.cmd` y `npx.cmd` para evitar conflictos con los wrappers `.ps1`.

## 1. Clonar

```powershell
gh auth status
gh repo clone jeannorambuena/inventario-terreno
Set-Location .\inventario-terreno
```

Lea `AGENTS.md` antes de ejecutar operaciones de datos.

## 2. Elegir un modo

El script no elige por usted:

```powershell
# Equipo sin datos previos.
.\scripts\setup.ps1 -Mode NUEVO

# Equipo al que se traspasará una base existente.
.\scripts\setup.ps1 -Mode RESTAURAR
```

Si la política de PowerShell bloquea scripts locales, use un bypass limitado a ese proceso, sin cambiar la política global:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Mode NUEVO
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Ambos modos detectan herramientas, ejecutan `npm.cmd ci`, las pruebas generales y las móviles, crean solo directorios privados faltantes y verifican las reglas de Git. No importan ni restauran datos automáticamente.

Si se desea autorizar una copia de datos durante la preparación, se debe proporcionar una ruta y el interruptor de confirmación:

```powershell
# NUEVO: copiar una fuente Excel protegida y crear la primera SQLite.
.\scripts\setup.ps1 -Mode NUEVO -ImportExcelPath 'D:\ruta\ACTIVOS.xlsx' -ConfirmDataOperation

# RESTAURAR: copiar una SQLite respaldada a un equipo sin base local.
.\scripts\setup.ps1 -Mode RESTAURAR -RestoreDatabasePath 'D:\respaldo\inventario.sqlite' -ConfirmDataOperation
```

Estas operaciones se detienen si el destino ya existe. Nunca sobrescriben `imports/ACTIVOS.xlsx` ni `data/inventario.sqlite`.

## 3. Verificar

```powershell
.\scripts\verify.ps1
```

El script informa `PASS` o `FAIL` para herramientas, dependencias, pruebas, SQLite, Excel opcional, protección Git, puerto, HTTP local y LAN. Para comprobar HTTP, el servidor debe estar activo.

## 4. Iniciar

```powershell
.\scripts\start.ps1
```

El proceso queda en primer plano y muestra:

- `http://localhost:3180`
- una URL por cada IPv4 privada disponible, por ejemplo `http://192.168.1.20:3180`

Si Windows Firewall pregunta, permita Node.js solo en redes privadas. No configure redirección de puertos en el router.

## 5. Verificar el Samsung

1. Conecte el Samsung a la misma Wi-Fi.
2. Abra la URL LAN mostrada por `start.ps1`.
3. Confirme que responde la interfaz.
4. Cree una sesión en el notebook y use el QR temporal para la vista móvil.

Consulte `docs/PRUEBA-MOVIL.md` para el recorrido manual.

## Bloqueos seguros

Deténgase y solicite ayuda si:

- Node.js no es 24.x;
- faltan Git, `gh` o `npm.cmd`;
- alguna prueba falla;
- el puerto 3180 está ocupado;
- ya existe una SQLite y se intenta incorporar otra;
- no se conoce si corresponde `NUEVO` o `RESTAURAR`;
- las rutas privadas dejan de estar ignoradas.
