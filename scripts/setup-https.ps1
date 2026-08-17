[CmdletBinding()]
param(
  [string]$AdditionalIp,
  [switch]$ConfirmCertificateCreation,
  [switch]$ConfirmOverwrite,
  [switch]$InstallLocalCA
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CertificateDirectory = Join-Path $ProjectRoot 'local-certs'
$CertificatePath = Join-Path $CertificateDirectory 'inventario-terreno-cert.pem'
$KeyPath = Join-Path $CertificateDirectory 'inventario-terreno-key.pem'
. (Join-Path $PSScriptRoot 'network.ps1')

function Test-PrivateIPv4 {
  param([Parameter(Mandatory)][string]$Address)

  $ParsedAddress = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$ParsedAddress)) { return $false }
  if ($ParsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  return ($Address -like '10.*' -or $Address -like '192.168.*' -or $Address -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
}

function Assert-PortAvailable {
  param([Parameter(Mandatory)][int]$Port)

  $Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($Listeners.Count -gt 0) {
    $Owners = $Listeners | Select-Object -ExpandProperty OwningProcess -Unique
    throw "El puerto $Port esta ocupado por PID: $($Owners -join ', '). Detenga el proceso de forma explicita antes de configurar HTTPS."
  }
}

Set-Location -LiteralPath $ProjectRoot

$Mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $Mkcert) {
  Write-Host 'mkcert no esta instalado. Instalelo de forma explicita desde una fuente oficial y vuelva a ejecutar este script.'
  Write-Host 'Opciones habituales en Windows:'
  Write-Host '  winget install FiloSottile.mkcert'
  Write-Host '  choco install mkcert'
  Write-Host 'Revise el origen y la version antes de aceptar. Este script no instala programas automaticamente.'
  exit 2
}

& git check-ignore -q -- 'local-certs/inventario-terreno-cert.pem'
if ($LASTEXITCODE -ne 0) {
  throw 'local-certs/ no esta protegido por .gitignore. No se crearon certificados.'
}

Assert-PortAvailable -Port 3180
Assert-PortAvailable -Port 3443

$LanCandidates = @(Get-PhysicalPrivateIPv4 -ProjectRoot $ProjectRoot)
$LanAddresses = @($LanCandidates | Select-Object -ExpandProperty IPAddress)
if ($AdditionalIp) {
  if (-not (Test-PrivateIPv4 -Address $AdditionalIp)) {
    throw 'AdditionalIp debe ser una IPv4 privada valida para Wi-Fi o hotspot.'
  }
  $LanAddresses += $AdditionalIp
}
$LanAddresses = @($LanAddresses | Select-Object -Unique)

if (-not $ConfirmCertificateCreation) {
  Write-Host 'No se crearon certificados. Revise los nombres que se incluirian:'
  Write-Host '  localhost'
  Write-Host '  127.0.0.1'
  foreach ($Address in $LanAddresses) { Write-Host "  $Address" }
  Write-Host 'Confirme explicitamente con -ConfirmCertificateCreation.'
  exit 2
}

$ExistingFiles = @(@($CertificatePath, $KeyPath) | Where-Object { Test-Path -LiteralPath $_ })
if ($ExistingFiles.Count -gt 0 -and -not $ConfirmOverwrite) {
  throw 'Ya existen certificados locales. Use -ConfirmOverwrite solo despues de confirmar que desea reemplazarlos.'
}

if (-not (Test-Path -LiteralPath $CertificateDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $CertificateDirectory | Out-Null
}

if ($InstallLocalCA) {
  Write-Host 'Instalando la CA local de mkcert en el almacen de confianza de este notebook por confirmacion explicita...'
  & $Mkcert.Source -install
  if ($LASTEXITCODE -ne 0) { throw 'mkcert no pudo instalar la CA local en Windows.' }
} else {
  Write-Host 'La CA local no se instalo automaticamente. Si aun no confia en ella, ejecute explicitamente: mkcert -install'
}

$Names = @('localhost', '127.0.0.1') + $LanAddresses
$Arguments = @('-cert-file', $CertificatePath, '-key-file', $KeyPath) + $Names
& $Mkcert.Source @Arguments
if ($LASTEXITCODE -ne 0) { throw 'mkcert no pudo crear el certificado local.' }

Write-Host 'Certificado HTTPS local creado dentro de local-certs/.'
Write-Host 'La CA no fue copiada al repositorio ni instalada en el telefono.'
Write-Host 'URLs configuradas:'
Write-Host '  http://localhost:3180'
Write-Host '  https://localhost:3443'
foreach ($Address in $LanAddresses) {
  Write-Host "  http://${Address}:3180"
  Write-Host "  https://${Address}:3443"
}
Write-Host 'Consulte docs/HTTPS-CAMARA.md para instalar y retirar manualmente la CA en el Samsung.'
