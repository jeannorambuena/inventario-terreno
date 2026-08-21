param(
  [string]$BackupPath,
  [string]$OutputRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups\packages')
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not $BackupPath) {
  $BackupPath = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'backups\operational') -Directory |
    Where-Object { $_.Name -like 'backup-*' } |
    Sort-Object Name |
    Select-Object -Last 1 -ExpandProperty FullName
}

if (-not $BackupPath) {
  throw 'No existe un backup operacional para empaquetar.'
}

$Backup = Get-Item -LiteralPath $BackupPath -ErrorAction Stop
if (-not $Backup.PSIsContainer -or $Backup.Name -notlike 'backup-*') {
  throw 'La fuente debe ser un directorio backup-*.'
}

Push-Location $ProjectRoot
try {
  & node .\src\database\operational-backup.js verify $Backup.FullName
  if ($LASTEXITCODE -ne 0) {
    throw 'El backup fuente no supera la verificación completa.'
  }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputRoot).Path
$ZipPath = Join-Path $OutputDirectory ($Backup.Name + '.zip')
$HashPath = $ZipPath + '.sha256.txt'

if ((Test-Path -LiteralPath $ZipPath) -or (Test-Path -LiteralPath $HashPath)) {
  throw 'El paquete destino ya existe; no se sobrescribirá.'
}

Compress-Archive -LiteralPath $Backup.FullName -DestinationPath $ZipPath -CompressionLevel Optimal
$Zip = Get-Item -LiteralPath $ZipPath
$Stream = [System.IO.File]::OpenRead($ZipPath)
try {
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $HashBytes = $Hasher.ComputeHash($Stream)
    $Hash = ([System.BitConverter]::ToString($HashBytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
  }
} finally {
  $Stream.Dispose()
}
Set-Content -LiteralPath $HashPath -Value ($Hash + ' *' + $Zip.Name) -Encoding ascii

Write-Output ''
Write-Output '=== PAQUETE DE RESPALDO OPERACIONAL ==='
Write-Output ('Backup fuente: ' + $Backup.FullName)
Write-Output ('ZIP: ' + $Zip.FullName)
Write-Output ('Tamaño: ' + $Zip.Length)
Write-Output ('SHA-256: ' + $Hash)
Write-Output ('Archivo SHA: ' + $HashPath)
Write-Output ('Fecha: ' + $Zip.LastWriteTime.ToString('o'))
Write-Output 'PAQUETE OPERACIONAL: PASS'
