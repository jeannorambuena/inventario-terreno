[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DatabasePath = Join-Path $ProjectRoot 'data\inventario.sqlite'
$ExcelPath = Join-Path $ProjectRoot 'imports\ACTIVOS.xlsx'
$script:FailureCount = 0

function Write-Result {
  param(
    [Parameter(Mandatory)][string]$Check,
    [Parameter(Mandatory)][bool]$Passed,
    [Parameter(Mandatory)][string]$Detail
  )

  $Status = if ($Passed) { 'PASS' } else { 'FAIL' }
  if (-not $Passed) { $script:FailureCount += 1 }
  Write-Host "[$Status] $Check - $Detail"
}

function Get-PrivateIPv4 {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    ($_.IPAddress -like '10.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
  } | Select-Object -ExpandProperty IPAddress -Unique)
}

Set-Location -LiteralPath $ProjectRoot

$MissingTools = @()
foreach ($tool in @('git', 'gh', 'node', 'npm.cmd')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $MissingTools += $tool }
}
Write-Result -Check 'Herramientas' -Passed ($MissingTools.Count -eq 0) -Detail $(
  if ($MissingTools.Count -eq 0) { 'Git, GitHub CLI, Node.js y npm.cmd disponibles.' }
  else { "Faltan: $($MissingTools -join ', ')" }
)

$NodeIs24 = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
  try {
    $NodeVersion = [version]((& node --version).TrimStart('v'))
    $NodeIs24 = $NodeVersion.Major -eq 24
  } catch { $NodeIs24 = $false }
}
Write-Result -Check 'Node.js 24' -Passed $NodeIs24 -Detail $(if ($NodeIs24) { 'Version compatible.' } else { 'Se requiere Node.js 24.x.' })

$DependenciesOk = $false
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
  & npm.cmd ls --depth=0 *> $null
  $DependenciesOk = $LASTEXITCODE -eq 0
}
Write-Result -Check 'Dependencias' -Passed $DependenciesOk -Detail $(if ($DependenciesOk) { 'node_modules coincide con package-lock.json.' } else { 'Ejecute npm.cmd ci.' })

$GeneralTestsOk = $false
$MobileTestsOk = $false
if ($DependenciesOk) {
  & npm.cmd test *> $null
  $GeneralTestsOk = $LASTEXITCODE -eq 0
  & npm.cmd run test:mobile *> $null
  $MobileTestsOk = $LASTEXITCODE -eq 0
}
Write-Result -Check 'Pruebas generales' -Passed $GeneralTestsOk -Detail $(if ($GeneralTestsOk) { 'Suite aprobada.' } else { 'Suite fallida o no ejecutable.' })
Write-Result -Check 'Pruebas moviles' -Passed $MobileTestsOk -Detail $(if ($MobileTestsOk) { 'Suite aprobada.' } else { 'Suite fallida o no ejecutable.' })

$DatabaseOk = $false
if (Test-Path -LiteralPath $DatabasePath -PathType Leaf) {
  $Probe = "import Database from 'better-sqlite3'; const db = new Database(process.argv[1], { readonly: true, fileMustExist: true }); const row = db.prepare('PRAGMA quick_check').get(); db.close(); if (Object.values(row)[0] !== 'ok') process.exit(1);"
  & node --input-type=module -e $Probe $DatabasePath *> $null
  $DatabaseOk = $LASTEXITCODE -eq 0
}
Write-Result -Check 'SQLite local' -Passed $DatabaseOk -Detail $(if ($DatabaseOk) { 'Base existente y quick_check correcto.' } else { 'Base ausente o no valida; elija NUEVO o RESTAURAR con autorizacion.' })

$ExcelExists = Test-Path -LiteralPath $ExcelPath -PathType Leaf
Write-Result -Check 'Excel local' -Passed $true -Detail $(if ($ExcelExists) { 'Fuente XLSX presente; no se abrio ni modifico.' } else { 'Fuente XLSX no presente (opcional si se restauro SQLite).' })

$Protected = $true
foreach ($relativePath in @('imports/ACTIVOS.xlsx', 'data/inventario.sqlite', 'backups/')) {
  & git check-ignore -q -- $relativePath
  if ($LASTEXITCODE -ne 0) { $Protected = $false }
}
Write-Result -Check 'Proteccion Git' -Passed $Protected -Detail $(if ($Protected) { 'imports/, data/ y backups/ estan ignorados.' } else { 'Una ruta privada no esta ignorada.' })

$Listeners = @(Get-NetTCPConnection -LocalPort 3180 -State Listen -ErrorAction SilentlyContinue)
$PortAcceptable = $Listeners.Count -eq 0
$PortDetail = 'Puerto 3180 disponible.'
if ($Listeners.Count -gt 0) {
  $ProjectServer = $true
  foreach ($listener in $Listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'src/server\.js') {
      $ProjectServer = $false
    }
  }
  $PortAcceptable = $ProjectServer
  $PortDetail = if ($ProjectServer) { 'Puerto 3180 ocupado por el servidor del proyecto.' } else { 'Puerto 3180 ocupado por otro proceso.' }
}
Write-Result -Check 'Puerto 3180' -Passed $PortAcceptable -Detail $PortDetail

$LocalHttpOk = $false
try {
  $LocalResponse = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3180' -TimeoutSec 3
  $LocalHttpOk = $LocalResponse.StatusCode -eq 200
} catch { $LocalHttpOk = $false }
Write-Result -Check 'HTTP local' -Passed $LocalHttpOk -Detail $(if ($LocalHttpOk) { 'http://localhost:3180 responde HTTP 200.' } else { 'Servidor no activo o sin respuesta HTTP 200.' })

$PrivateAddresses = Get-PrivateIPv4
$LanHttpOk = $false
$LanUrl = $null
foreach ($address in $PrivateAddresses) {
  try {
    $candidateUrl = "http://${address}:3180"
    $LanResponse = Invoke-WebRequest -UseBasicParsing -Uri $candidateUrl -TimeoutSec 3
    if ($LanResponse.StatusCode -eq 200) {
      $LanHttpOk = $true
      $LanUrl = $candidateUrl
      break
    }
  } catch { }
}
Write-Result -Check 'Acceso LAN' -Passed $LanHttpOk -Detail $(if ($LanHttpOk) { "$LanUrl responde HTTP 200." } else { 'No se obtuvo HTTP 200 mediante una IPv4 privada.' })

if ($script:FailureCount -gt 0) {
  Write-Host "Verificacion finalizada con $script:FailureCount comprobacion(es) FAIL."
  exit 1
}

Write-Host 'Verificacion finalizada: todas las comprobaciones obligatorias estan en PASS.'
