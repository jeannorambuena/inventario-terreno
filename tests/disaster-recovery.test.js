import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const projectRoot = resolve('.');
const readProjectFile = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

describe('disaster recovery documentation', () => {
  test('keeps the operational backup as the documented canonical mechanism', () => {
    const readme = readProjectFile('README.md');
    const agents = readProjectFile('AGENTS.md');
    const handover = readProjectFile('docs/HANDOVER.md');
    const backup = readProjectFile('docs/RESPALDO-RESTAURACION.md');

    expect(readme).toContain('backup:operational');
    expect(readme).toContain('docs/RECUPERACION-DESASTRE.md');
    expect(agents).toContain('LEGACY / respaldo SQLite simple');
    expect(handover).toContain('npm.cmd run backup:operational');
    expect(backup).toContain('manifest.json');
    expect(backup).toContain('operational-backup.js restore');
  });

  test('documents a complete rebuild without the original devices', () => {
    const installation = readProjectFile('docs/INSTALACION-WINDOWS.md');
    const disaster = readProjectFile('docs/RECUPERACION-DESASTRE.md');

    expect(installation).toContain('### B. RESTAURAR');
    expect(installation).toContain('operational-backup.js restore');
    expect(disaster).toContain('git switch main');
    expect(disaster).toContain('main` es la rama principal y canónica de recuperación');
    expect(disaster).not.toContain('git switch feature/field-ux-integrity');
    expect(disaster).toContain('## PASO 19');
    expect(disaster).toContain('## RPO');
    expect(disaster).toContain('## RTO');
    expect(disaster).toContain('CONTROL ORGANIZACIONAL / USUARIO');
    expect(disaster).not.toContain('drive.google.com');
  });

  test('exposes the packaging and recovery drill commands', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const packaging = readProjectFile('scripts/package-operational-backup.ps1');
    const drill = readProjectFile('scripts/recovery-drill.js');

    expect(packageJson.scripts['backup:package']).toBeTruthy();
    expect(packageJson.scripts['recovery:drill']).toBeTruthy();
    expect(packaging.indexOf('operational-backup.js verify'))
      .toBeLessThan(packaging.indexOf('Compress-Archive'));
    expect(drill).toContain('mkdtempSync');
    expect(drill).toContain('restoreOperationalBackup');
  });
});
