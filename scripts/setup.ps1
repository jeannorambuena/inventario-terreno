[CmdletBinding()]
param(
  [ValidateSet('NUEVO', 'RESTAURAR')]
  [string]$Mode,

  [string]$ImportExcelPath,

  [string]$RestoreDatabasePath,

  [switch]$ConfirmDataOperation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DatabasePath = Join-Path $ProjectRoot 'data\inventario.sqlite'
$ExcelPath = Join-Path $ProjectRoot 'imports\ACTIVOS.xlsx'

function Assert-Command {
  param([Parameter(Mandatory)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Falta la herramienta requerida: $Name. Instalela desde su fuente oficial y vuelva a ejecutar el script."
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Program,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "El comando $Program fallo con codigo $LASTEXITCODE."
  }
}

function Assert-IgnoredPath {
  param([Parameter(Mandatory)][string]$RelativePath)

  & git check-ignore -q -- $RelativePath
  if ($LASTEXITCODE -ne 0) {
    throw "La ruta privada no esta protegida por .gitignore: $RelativePath"
  }
}

function Assert-ExplicitDataAuthorization {
  if (-not $ConfirmDataOperation) {
    throw 'La operacion de datos requiere -ConfirmDataOperation. No se realizo ninguna copia ni importacion.'
  }
}

if (-not $Mode) {
  Write-Host 'Debe elegir un modo explicitamente:'
  Write-Host '  .\scripts\setup.ps1 -Mode NUEVO'
  Write-Host '  .\scripts\setup.ps1 -Mode RESTAURAR'
  exit 2
}

if ($ImportExcelPath -and $RestoreDatabasePath) {
  throw 'No combine una importacion NUEVO con una restauracion en la misma ejecucion.'
}
if ($Mode -eq 'NUEVO' -and $RestoreDatabasePath) {
  throw 'RestoreDatabasePath solo se permite en modo RESTAURAR.'
}
if ($Mode -eq 'RESTAURAR' -and $ImportExcelPath) {
  throw 'ImportExcelPath solo se permite en modo NUEVO.'
}

Set-Location -LiteralPath $ProjectRoot

foreach ($tool in @('git', 'gh', 'node', 'npm.cmd')) {
  Assert-Command -Name $tool
}

$NodeVersion = (& node --version).TrimStart('v')
if ([version]$NodeVersion -lt [version]'24.0.0' -or [version]$NodeVersion -ge [version]'25.0.0') {
  throw "Se requiere Node.js 24.x. Version detectada: $NodeVersion"
}

$null = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub CLI esta instalado, pero no hay una sesion autenticada. Ejecute gh auth login.'
}

foreach ($privateDirectory in @('imports', 'data', 'backups')) {
  $directoryPath = Join-Path $ProjectRoot $privateDirectory
  if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) {
    New-Item -ItemType Directory -Path $directoryPath | Out-Null
  }
}

Assert-IgnoredPath -RelativePath 'imports/ACTIVOS.xlsx'
Assert-IgnoredPath -RelativePath 'data/inventario.sqlite'
Assert-IgnoredPath -RelativePath 'backups/'

Write-Host 'Instalando dependencias reproducibles con npm.cmd ci...'
Invoke-Checked -Program 'npm.cmd' -Arguments @('ci')
Write-Host 'Ejecutando pruebas generales...'
Invoke-Checked -Program 'npm.cmd' -Arguments @('test')
Write-Host 'Ejecutando pruebas moviles...'
Invoke-Checked -Program 'npm.cmd' -Arguments @('run', 'test:mobile')

if ($Mode -eq 'NUEVO' -and $ImportExcelPath) {
  Assert-ExplicitDataAuthorization
  if (Test-Path -LiteralPath $DatabasePath) {
    throw 'Ya existe data/inventario.sqlite. Se detuvo la importacion para no sobrescribir ni mezclar datos.'
  }
  if (Test-Path -LiteralPath $ExcelPath) {
    throw 'Ya existe imports/ACTIVOS.xlsx. Se detuvo la operacion para no sobrescribir la fuente local.'
  }
  $ResolvedExcel = Resolve-Path -LiteralPath $ImportExcelPath
  if ([IO.Path]::GetExtension($ResolvedExcel.Path) -ne '.xlsx') {
    throw 'La fuente autorizada debe ser un archivo .xlsx.'
  }
  Copy-Item -LiteralPath $ResolvedExcel.Path -Destination $ExcelPath
  Invoke-Checked -Program 'npm.cmd' -Arguments @('run', 'import')
  Invoke-Checked -Program 'npm.cmd' -Arguments @('run', 'backup')
  Write-Host 'Importacion NUEVO completada sin sobrescribir datos previos.'
}

if ($Mode -eq 'RESTAURAR' -and $RestoreDatabasePath) {
  Assert-ExplicitDataAuthorization
  if (Test-Path -LiteralPath $DatabasePath) {
    throw 'Ya existe data/inventario.sqlite. Se detuvo la restauracion para no sobrescribir la base local.'
  }
  $ResolvedDatabase = Resolve-Path -LiteralPath $RestoreDatabasePath
  if ([IO.Path]::GetExtension($ResolvedDatabase.Path) -notin @('.sqlite', '.sqlite3', '.db')) {
    throw 'El respaldo autorizado debe tener extension .sqlite, .sqlite3 o .db.'
  }
  $DatabaseProbe = "import Database from 'better-sqlite3'; const db = new Database(process.argv[1], { readonly: true, fileMustExist: true }); db.prepare('PRAGMA quick_check').get(); db.close();"
  & node --input-type=module -e $DatabaseProbe $ResolvedDatabase.Path
  if ($LASTEXITCODE -ne 0) {
    throw 'El archivo indicado no pudo validarse como SQLite de solo lectura.'
  }
  Copy-Item -LiteralPath $ResolvedDatabase.Path -Destination $DatabasePath
  Invoke-Checked -Program 'npm.cmd' -Arguments @('run', 'backup')
  Write-Host 'Restauracion completada sin sobrescribir una base existente.'
}

if ($Mode -eq 'NUEVO' -and -not $ImportExcelPath) {
  Write-Host 'Modo NUEVO preparado. No se importaron datos porque no se autorizo una fuente.'
}
if ($Mode -eq 'RESTAURAR' -and -not $RestoreDatabasePath) {
  Write-Host 'Modo RESTAURAR preparado. No se copio ninguna base porque no se autorizo una fuente.'
}

Write-Host 'Preparacion finalizada. Ejecute .\scripts\verify.ps1 antes de iniciar operacion.'
