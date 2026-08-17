[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot 'start.ps1'
$RuntimeDirectory = Join-Path $ProjectRoot 'tmp\launcher'
$RuntimeStatePath = Join-Path $RuntimeDirectory 'server-process.json'
$StandardOutputPath = Join-Path $RuntimeDirectory 'server-output.log'
$StandardErrorPath = Join-Path $RuntimeDirectory 'server-error.log'
$HealthUrl = 'http://localhost:3180/api/health'
$ApplicationUrl = 'http://localhost:3180'

function Test-InventoryHealth {
  try {
    $Response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 3 -UseBasicParsing
    return $Response.ok -eq $true -and $Response.service -eq 'inventario-terreno'
  } catch {
    return $false
  }
}

function Get-PortListeners {
  param([Parameter(Mandatory)][int]$Port)
  return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-StartedProcessTree {
  param([Parameter(Mandatory)][int]$ProcessId)
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    & taskkill.exe /PID $ProcessId /T /F *> $null
  }
}

try {
  Set-Location -LiteralPath $ProjectRoot

  if (Test-InventoryHealth) {
    Write-Host 'Inventario Terreno ya está ejecutándose.' -ForegroundColor Green
    Write-Host 'Abriendo la aplicación…'
    Start-Process -FilePath $ApplicationUrl
    exit 0
  }

  $HttpListeners = @(Get-PortListeners -Port 3180)
  if ($HttpListeners.Count -gt 0) {
    throw 'El puerto 3180 está ocupado por otra aplicación. Inventario Terreno no fue iniciado.'
  }
  $HttpsListeners = @(Get-PortListeners -Port 3443)
  if ($HttpsListeners.Count -gt 0) {
    throw 'El puerto 3443 está ocupado por otra aplicación. Inventario Terreno no fue iniciado.'
  }

  if (-not (Test-Path -LiteralPath $StartScript -PathType Leaf)) {
    throw 'No se encontró scripts\start.ps1. La instalación está incompleta.'
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js no está disponible. Solicite asistencia para completar la instalación.'
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd no está disponible. Solicite asistencia para completar la instalación.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules') -PathType Container)) {
    throw 'Faltan las dependencias instaladas. El launcher no instalará ni modificará nada.'
  }

  New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
  $PowerShellExecutable = (Get-Process -Id $PID).Path
  if (-not $PowerShellExecutable) { $PowerShellExecutable = 'powershell.exe' }
  $Arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$StartScript`""
  )

  Write-Host 'Iniciando Inventario Terreno…'
  $ServerProcess = Start-Process `
    -FilePath $PowerShellExecutable `
    -ArgumentList $Arguments `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StandardOutputPath `
    -RedirectStandardError $StandardErrorPath `
    -PassThru

  [pscustomobject]@{
    launcherPid = $ServerProcess.Id
    startedAt = $ServerProcess.StartTime.ToUniversalTime().ToString('o')
    projectRoot = $ProjectRoot
  } | ConvertTo-Json | Set-Content -LiteralPath $RuntimeStatePath -Encoding UTF8

  $Deadline = (Get-Date).AddSeconds(45)
  do {
    if (Test-InventoryHealth) {
      Write-Host 'Inventario Terreno está listo.' -ForegroundColor Green
      Write-Host 'Abriendo la aplicación…'
      Start-Process -FilePath $ApplicationUrl
      exit 0
    }
    if ($ServerProcess.HasExited) {
      $Detail = @(Get-Content -LiteralPath $StandardErrorPath -ErrorAction SilentlyContinue | Select-Object -Last 5)
      if ($Detail.Count -gt 0) { Write-Host ($Detail -join [Environment]::NewLine) -ForegroundColor Yellow }
      throw 'El servidor se cerró antes de quedar disponible.'
    }
    Start-Sleep -Milliseconds 500
    $ServerProcess.Refresh()
  } while ((Get-Date) -lt $Deadline)

  Stop-StartedProcessTree -ProcessId $ServerProcess.Id
  throw 'El servidor no respondió a tiempo y fue detenido de forma segura.'
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
