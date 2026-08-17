import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const setup = readFileSync(new URL('../scripts/setup.ps1', import.meta.url), 'utf8');
const verify = readFileSync(new URL('../scripts/verify.ps1', import.meta.url), 'utf8');
const start = readFileSync(new URL('../scripts/start.ps1', import.meta.url), 'utf8');
const setupHttps = readFileSync(new URL('../scripts/setup-https.ps1', import.meta.url), 'utf8');
const networkPowerShell = readFileSync(new URL('../scripts/network.ps1', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../scripts/launch.ps1', import.meta.url), 'utf8');
const stopLauncher = readFileSync(new URL('../scripts/stop-launcher.ps1', import.meta.url), 'utf8');
const launcherCmd = readFileSync(new URL('../Iniciar Inventario Terreno.cmd', import.meta.url), 'utf8');
const stopCmd = readFileSync(new URL('../Detener Inventario Terreno.cmd', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

describe('Windows assisted installation scripts', () => {
  test('setup requires an explicit mode and reproducible npm installation', () => {
    expect(setup).toContain("[ValidateSet('NUEVO', 'RESTAURAR')]");
    expect(setup).toContain("if (-not $Mode)");
    expect(setup).toContain("@('ci')");
    expect(setup).toContain("@('test')");
    expect(setup).toContain("@('run', 'test:mobile')");
    expect(setup).toContain("@('run', 'backup')");
    expect(setup).toContain('Assert-PortAvailable -Port 3180');
    expect(setup).toContain('Assert-PortAvailable -Port 3443');
    expect(setup).toContain('Get-Command mkcert');
  });

  test('setup never overwrites a database or Excel source silently', () => {
    expect(setup).toContain('ConfirmDataOperation');
    expect(setup).toContain("Test-Path -LiteralPath $DatabasePath");
    expect(setup).toContain("Test-Path -LiteralPath $ExcelPath");
    expect(setup).not.toMatch(/Copy-Item[^\n]+-Force/);
    expect(setup).not.toMatch(/Remove-Item|rm\s+-/i);
  });

  test('verify reports every required operational category', () => {
    for (const check of [
      'Herramientas',
      'Dependencias',
      'Pruebas generales',
      'Pruebas moviles',
      'SQLite local',
      'Excel local',
      'Proteccion Git',
      'Puerto 3180',
      'Puerto 3443',
      'HTTP local',
      'HTTPS local',
      'Acceso LAN',
      'Acceso LAN HTTPS',
      'Certificado HTTPS',
      'mkcert',
    ]) {
      expect(verify).toContain(`-Check '${check}'`);
    }
    expect(verify).not.toContain('Authorization:');
  });

  test('PowerShell scripts reuse the physical interface classification from src/network.js', () => {
    expect(networkPowerShell).toContain("from './src/network.js'");
    expect(networkPowerShell).toContain("mobileBaseUrl: ''");
    expect(networkPowerShell).toContain('Get-PhysicalPrivateIPv4');
    expect(networkPowerShell).toContain("Candidate.PSObject.Properties['address'].Value");
    for (const script of [verify, start, setupHttps]) {
      expect(script).toContain("Join-Path $PSScriptRoot 'network.ps1'");
      expect(script).toContain('Get-PhysicalPrivateIPv4 -ProjectRoot $ProjectRoot');
    }
    expect(verify).not.toContain('Get-NetIPAddress');
    expect(setupHttps).not.toContain('Get-NetIPAddress');
  });

  test('start checks both ports, enables local TLS and never imports', () => {
    expect(start).toContain('[string]$MobileBaseUrl');
    expect(start).toContain('$env:MOBILE_BASE_URL');
    expect(networkPowerShell).toContain('getMobileNetworkInfo');
    expect(start).toContain('Candidata LAN fisica');
    expect(start).toContain('foreach ($Port in @(3180, 3443))');
    expect(start).toContain('Get-NetTCPConnection -LocalPort $Port');
    expect(start).toContain('& npm.cmd start');
    expect(start).toContain('0.0.0.0:3180');
    expect(start).toContain('0.0.0.0:3443');
    expect(start).toContain('INVENTARIO_TLS_CERT_PATH');
    expect(start).toContain('INVENTARIO_TLS_KEY_PATH');
    expect(start).not.toMatch(/npm\.cmd\s+run\s+import/);
    expect(start).not.toMatch(/Remove-Item|Stop-Process/);
  });

  test('HTTPS setup requires explicit confirmations and never transports data or the CA', () => {
    expect(setupHttps).toContain('Get-Command mkcert');
    expect(setupHttps).toContain('ConfirmCertificateCreation');
    expect(setupHttps).toContain('ConfirmOverwrite');
    expect(setupHttps).toContain('InstallLocalCA');
    expect(setupHttps).toContain('AdditionalIp');
    expect(setupHttps).toContain("Assert-PortAvailable -Port 3180");
    expect(setupHttps).toContain("Assert-PortAvailable -Port 3443");
    expect(setupHttps).toContain("local-certs");
    expect(setupHttps).not.toMatch(/Copy-Item|npm\.cmd\s+run\s+import|adb\s+/i);
  });

  test('Node server uses native HTTPS only when certificate paths are provided', () => {
    expect(server).toContain("from 'node:https'");
    expect(server).toContain('INVENTARIO_TLS_CERT_PATH');
    expect(server).toContain('INVENTARIO_TLS_KEY_PATH');
    expect(server).toContain('HTTPS_PORT = 3443');
  });

  test('double-click launcher uses relative paths and bypasses policy only for its PowerShell process', () => {
    expect(launcherCmd).toContain('%~dp0');
    expect(launcherCmd).toContain('-NoProfile -ExecutionPolicy Bypass');
    expect(launcherCmd).toContain('scripts\\launch.ps1');
    expect(launcher).toContain("Join-Path $PSScriptRoot 'start.ps1'");
    expect(launcher).toContain("$HealthUrl = 'http://localhost:3180/api/health'");
    expect(launcher).toContain("$ApplicationUrl = 'http://localhost:3180'");
    expect(launcher).toContain("$Response.service -eq 'inventario-terreno'");
    expect(launcher).toContain('Inventario Terreno ya está ejecutándose.');
    expect(launcher).toContain('Start-Process -FilePath $ApplicationUrl');
    expect(launcher).toContain('-WindowStyle Hidden');
    expect(launcher).not.toMatch(/npm\.cmd\s+(?:ci|install)|run\s+import|ACTIVOS\.xlsx|inventario\.sqlite/i);
  });

  test('controlled stop refuses untrusted processes and only closes the recorded process tree', () => {
    expect(stopCmd).toContain('%~dp0');
    expect(stopCmd).toContain('-NoProfile -ExecutionPolicy Bypass');
    expect(stopLauncher).toContain("tmp\\launcher\\server-process.json");
    expect(stopLauncher).toContain("$State.projectRoot -ne $ProjectRoot");
    expect(stopLauncher).toContain("$Launcher.StartTime.ToUniversalTime().ToString('o')");
    expect(stopLauncher).toContain('Get-DescendantProcessIds');
    expect(stopLauncher).toContain('Get-NetTCPConnection -LocalPort 3180');
    expect(stopLauncher).toContain('taskkill.exe /PID $LauncherPid /T /F');
    expect(stopLauncher).toContain('no fue iniciado por este launcher');
    expect(stopLauncher).not.toMatch(/run\s+import|ACTIVOS\.xlsx|inventario\.sqlite/i);
  });

  test('Linux setup and start scripts remain outside the project scope', () => {
    for (const relativePath of [
      '../scripts/setup.sh',
      '../scripts/start.sh',
      '../scripts/verify.sh',
      '../scripts/setup-https.sh',
    ]) {
      expect(existsSync(new URL(relativePath, import.meta.url))).toBe(false);
    }
  });
});
