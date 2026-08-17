[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeStatePath = Join-Path $ProjectRoot 'tmp\launcher\server-process.json'
$HealthUrl = 'http://localhost:3180/api/health'

function Test-InventoryHealth {
  try {
    $Response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 3 -UseBasicParsing
    return $Response.ok -eq $true -and $Response.service -eq 'inventario-terreno'
  } catch {
    return $false
  }
}

function Get-DescendantProcessIds {
  param([Parameter(Mandatory)][int]$RootProcessId)
  $Known = [System.Collections.Generic.HashSet[int]]::new()
  [void]$Known.Add($RootProcessId)
  do {
    $Added = $false
    foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      if ($Known.Contains([int]$Process.ParentProcessId) -and $Known.Add([int]$Process.ProcessId)) {
        $Added = $true
      }
    }
  } while ($Added)
  return @($Known)
}

try {
  if (-not (Test-Path -LiteralPath $RuntimeStatePath -PathType Leaf)) {
    if (Test-InventoryHealth) {
      throw 'El servidor está activo, pero no fue iniciado por este launcher. No se detendrá automáticamente.'
    }
    Write-Host 'Inventario Terreno ya está detenido.' -ForegroundColor Green
    exit 0
  }

  $State = Get-Content -LiteralPath $RuntimeStatePath -Raw | ConvertFrom-Json
  if ($State.projectRoot -ne $ProjectRoot) {
    throw 'El registro de ejecución no corresponde a este proyecto.'
  }
  $LauncherPid = [int]$State.launcherPid
  $Launcher = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
  if (-not $Launcher) {
    throw 'El proceso registrado ya no existe. No se detendrá ningún otro proceso.'
  }
  if ($Launcher.StartTime.ToUniversalTime().ToString('o') -ne [string]$State.startedAt) {
    throw 'El PID fue reutilizado por otro proceso. No se realizará el cierre.'
  }
  if (-not (Test-InventoryHealth)) {
    throw 'El proceso registrado no responde como Inventario Terreno. No se realizará el cierre.'
  }

  $Descendants = @(Get-DescendantProcessIds -RootProcessId $LauncherPid)
  $HttpOwners = @(Get-NetTCPConnection -LocalPort 3180 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  if ($HttpOwners.Count -ne 1 -or $Descendants -notcontains [int]$HttpOwners[0]) {
    throw 'No fue posible vincular de forma segura el servidor con el launcher.'
  }

  Write-Host 'Deteniendo Inventario Terreno…'
  & taskkill.exe /PID $LauncherPid /T /F *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Windows no permitió detener el proceso.' }

  $Deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $Deadline -and (Test-InventoryHealth)) {
    Start-Sleep -Milliseconds 300
  }
  if (Test-InventoryHealth) { throw 'El servidor continúa respondiendo y requiere asistencia.' }

  Remove-Item -LiteralPath $RuntimeStatePath -Force
  Write-Host 'Inventario Terreno se detuvo correctamente.' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
