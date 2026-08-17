[CmdletBinding()]
param(
  [string]$MobileBaseUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CertificatePath = Join-Path $ProjectRoot 'local-certs\inventario-terreno-cert.pem'
$KeyPath = Join-Path $ProjectRoot 'local-certs\inventario-terreno-key.pem'
. (Join-Path $PSScriptRoot 'network.ps1')

Set-Location -LiteralPath $ProjectRoot

if ($MobileBaseUrl) {
  $ParsedMobileBaseUrl = $null
  if (-not [Uri]::TryCreate($MobileBaseUrl, [UriKind]::Absolute, [ref]$ParsedMobileBaseUrl) -or
      $ParsedMobileBaseUrl.Scheme -notin @('http', 'https') -or
      $ParsedMobileBaseUrl.UserInfo -or
      $ParsedMobileBaseUrl.AbsolutePath -ne '/' -or
      $ParsedMobileBaseUrl.Query -or
      $ParsedMobileBaseUrl.Fragment) {
    throw 'MobileBaseUrl debe contener solamente una URL HTTP/HTTPS valida, sin credenciales, ruta, consulta ni fragmento.'
  }
  $env:MOBILE_BASE_URL = $ParsedMobileBaseUrl.GetLeftPart([UriPartial]::Authority)
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no esta instalado.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd no esta disponible.'
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules') -PathType Container)) {
  throw 'Faltan dependencias. Ejecute .\scripts\setup.ps1 con un modo explicito.'
}

foreach ($Port in @(3180, 3443)) {
  $Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($Listeners.Count -gt 0) {
    $Owners = $Listeners | Select-Object -ExpandProperty OwningProcess -Unique
    throw "El puerto $Port ya esta ocupado por PID: $($Owners -join ', '). Detenga el proceso de forma explicita antes de iniciar."
  }
}

Write-Host 'Servidor local: http://localhost:3180'
$CertificateExists = Test-Path -LiteralPath $CertificatePath -PathType Leaf
$KeyExists = Test-Path -LiteralPath $KeyPath -PathType Leaf
if ($CertificateExists -ne $KeyExists) {
  throw 'La configuracion HTTPS esta incompleta: deben existir tanto el certificado como la clave en local-certs/.'
}
$HttpsEnabled = $CertificateExists -and $KeyExists
if ($HttpsEnabled) {
  $env:INVENTARIO_TLS_CERT_PATH = $CertificatePath
  $env:INVENTARIO_TLS_KEY_PATH = $KeyPath
  Write-Host 'Servidor HTTPS local: https://localhost:3443'
} else {
  $env:INVENTARIO_TLS_CERT_PATH = $null
  $env:INVENTARIO_TLS_KEY_PATH = $null
  Write-Host 'HTTPS no configurado. Ejecute .\scripts\setup-https.ps1 con confirmacion explicita.'
}
$ConfiguredMobileBaseUrl = [Environment]::GetEnvironmentVariable('MOBILE_BASE_URL', 'Process')
$PrivateAddresses = @(Get-PhysicalPrivateIPv4 -ProjectRoot $ProjectRoot)
if ($ConfiguredMobileBaseUrl) {
  Write-Host "MOBILE_BASE_URL seleccionada para este proceso: $ConfiguredMobileBaseUrl"
  Write-Host "Servidor movil: $ConfiguredMobileBaseUrl/mobile"
} elseif ($PrivateAddresses.Count -eq 0) {
  Write-Warning 'No se detecto una interfaz fisica confiable. Configure -MobileBaseUrl; localhost seguira funcionando.'
} else {
  foreach ($candidate in $PrivateAddresses) {
    Write-Host "Candidata LAN fisica: $($candidate.InterfaceAlias) ($($candidate.IPAddress))"
  }
  $SelectedAddress = $PrivateAddresses[0].IPAddress
  Write-Host "Interfaz LAN seleccionada: $($PrivateAddresses[0].InterfaceAlias) ($SelectedAddress)"
  Write-Host "Servidor LAN HTTP: http://${SelectedAddress}:3180"
  if ($HttpsEnabled) { Write-Host "Servidor LAN HTTPS: https://${SelectedAddress}:3443" }
}
Write-Host 'Iniciando HTTP en 0.0.0.0:3180 y, si esta configurado, HTTPS en 0.0.0.0:3443.'
Write-Host 'Este script no ejecuta importaciones ni modifica Excel o SQLite.'

& npm.cmd start
exit $LASTEXITCODE
