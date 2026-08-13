import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const setup = readFileSync(new URL('../scripts/setup.ps1', import.meta.url), 'utf8');
const verify = readFileSync(new URL('../scripts/verify.ps1', import.meta.url), 'utf8');
const start = readFileSync(new URL('../scripts/start.ps1', import.meta.url), 'utf8');

describe('Windows assisted installation scripts', () => {
  test('setup requires an explicit mode and reproducible npm installation', () => {
    expect(setup).toContain("[ValidateSet('NUEVO', 'RESTAURAR')]");
    expect(setup).toContain("if (-not $Mode)");
    expect(setup).toContain("@('ci')");
    expect(setup).toContain("@('test')");
    expect(setup).toContain("@('run', 'test:mobile')");
    expect(setup).toContain("@('run', 'backup')");
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
      'HTTP local',
      'Acceso LAN',
    ]) {
      expect(verify).toContain(`-Check '${check}'`);
    }
    expect(verify).not.toContain('Authorization:');
  });

  test('start checks the port, uses npm.cmd start and never imports', () => {
    expect(start).toContain('Get-NetTCPConnection -LocalPort 3180');
    expect(start).toContain('& npm.cmd start');
    expect(start).toContain('0.0.0.0:3180');
    expect(start).not.toMatch(/npm\.cmd\s+run\s+import/);
    expect(start).not.toMatch(/Remove-Item|Stop-Process/);
  });
});
