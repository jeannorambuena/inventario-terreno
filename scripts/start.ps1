[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Get-PrivateIPv4 {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    ($_.IPAddress -like '10.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
  } | Select-Object -ExpandProperty IPAddress -Unique)
}

Set-Location -LiteralPath $ProjectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no esta instalado.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd no esta disponible.'
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules') -PathType Container)) {
  throw 'Faltan dependencias. Ejecute .\scripts\setup.ps1 con un modo explicito.'
}

$Listeners = @(Get-NetTCPConnection -LocalPort 3180 -State Listen -ErrorAction SilentlyContinue)
if ($Listeners.Count -gt 0) {
  $Owners = $Listeners | Select-Object -ExpandProperty OwningProcess -Unique
  throw "El puerto 3180 ya esta ocupado por PID: $($Owners -join ', '). Detenga el proceso de forma explicita antes de iniciar."
}

Write-Host 'Servidor local: http://localhost:3180'
$PrivateAddresses = Get-PrivateIPv4
if ($PrivateAddresses.Count -eq 0) {
  Write-Host 'No se detecto una IPv4 privada. Conecte el notebook a la red local antes de usar el telefono.'
} else {
  foreach ($address in $PrivateAddresses) {
    Write-Host "Servidor LAN: http://${address}:3180"
  }
}
Write-Host 'Iniciando en 0.0.0.0:3180. Este script no ejecuta importaciones.'

& npm.cmd start
exit $LASTEXITCODE
