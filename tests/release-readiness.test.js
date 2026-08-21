import {
  afterEach,
  describe,
  expect,
  test,
} from 'vitest';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  dirname,
  join,
} from 'node:path';

import {
  tmpdir,
} from 'node:os';

import {
  inspectReleaseReadiness,
} from '../scripts/release-readiness.js';


const roots = [];


afterEach(() => {
  while (roots.length) {
    rmSync(
      roots.pop(),
      {
        recursive: true,
        force: true,
      },
    );
  }
});


function write(root, relativePath, content = '') {
  const filePath =
    join(root, relativePath);

  mkdirSync(
    dirname(filePath),
    {
      recursive: true,
    },
  );

  writeFileSync(
    filePath,
    content,
    'utf8',
  );
}


function createReadyFixture() {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        'inventario-release-',
      ),
    );

  roots.push(root);

  const scripts = {
    test: 'vitest run',
    'verify:field': 'node verify.js',
    'backup:operational': 'node backup.js create',
    'backup:verify': 'node backup.js verify-latest',
    'release:check': 'node scripts/release-readiness.js',
    'pilot:preflight': 'npm test && npm run release:check',
  };

  write(
    root,
    'package.json',
    JSON.stringify(
      {
        name: 'inventario-terreno',
        version: '1.0.0',
        scripts,
      },
      null,
      2,
    ),
  );

  write(root, 'AGENTS.md', '# Rules\n');
  write(root, 'scripts/verify-field-integrity.js', '// ok\n');
  write(root, 'src/database/operational-backup.js', '// ok\n');
  write(root, 'docs/ACEPTACION-PILOTO.md', '# Pilot\n');
  write(root, 'docs/OPERACION-DIARIA.md', '# Daily\n');
  write(root, 'docs/RELEASE-1.0.md', '# Release\n');

  write(
    root,
    '.gitignore',
    'data/\nevidence/\nbackups/\nimports/\nexports/\nlocal-certs/\n',
  );

  write(
    root,
    'README.md',
    [
      'docs/ACEPTACION-PILOTO.md',
      'docs/OPERACION-DIARIA.md',
      'docs/RELEASE-1.0.md',
      'pilot:preflight',
    ].join('\n'),
  );

  const backup =
    join(
      root,
      'backups',
      'operational',
      'backup-20260819-190426011Z',
    );

  mkdirSync(
    join(backup, 'evidence'),
    {
      recursive: true,
    },
  );

  writeFileSync(
    join(backup, 'inventario.sqlite'),
    'synthetic-sqlite-for-structure-test',
  );

  writeFileSync(
    join(backup, 'manifest.json'),
    JSON.stringify(
      {
        kind:
          'inventario-terreno-operational-backup',
        copyStatus: 'PASS',
      },
      null,
      2,
    ),
    'utf8',
  );

  return root;
}


describe(
  'release readiness',
  () => {
    test(
      'aprueba una estructura candidata completa',
      () => {
        const root =
          createReadyFixture();

        const report =
          inspectReleaseReadiness({
            root,
            nodeVersion: '24.19.0',
          });

        expect(report.status).toBe('PASS');
        expect(report.failures).toBe(0);
      },
    );

    test(
      'falla fuera de Node 24',
      () => {
        const root =
          createReadyFixture();

        const report =
          inspectReleaseReadiness({
            root,
            nodeVersion: '22.22.0',
          });

        expect(report.status).toBe('FAIL');
        expect(
          report.checks.find(
            ({ name }) =>
              name === 'Node.js 24',
          ).status,
        ).toBe('FAIL');
      },
    );

    test(
      'falla si falta documentacion de aceptacion',
      () => {
        const root =
          createReadyFixture();

        rmSync(
          join(
            root,
            'docs',
            'ACEPTACION-PILOTO.md',
          ),
        );

        const report =
          inspectReleaseReadiness({
            root,
            nodeVersion: '24.19.0',
          });

        expect(report.status).toBe('FAIL');
      },
    );

    test(
      'falla si una frontera privada deja de estar ignorada',
      () => {
        const root =
          createReadyFixture();

        write(
          root,
          '.gitignore',
          'data/\nevidence/\nimports/\nexports/\nlocal-certs/\n',
        );

        const report =
          inspectReleaseReadiness({
            root,
            nodeVersion: '24.19.0',
          });

        expect(report.status).toBe('FAIL');
        expect(
          report.checks.find(
            ({ name }) =>
              name
              === 'Frontera de datos privados',
          ).status,
        ).toBe('FAIL');
      },
    );

    test(
      'falla si no existe respaldo operacional',
      () => {
        const root =
          createReadyFixture();

        rmSync(
          join(root, 'backups'),
          {
            recursive: true,
            force: true,
          },
        );

        const report =
          inspectReleaseReadiness({
            root,
            nodeVersion: '24.19.0',
          });

        expect(report.status).toBe('FAIL');
        expect(
          report.checks.find(
            ({ name }) =>
              name
              === 'Respaldo operacional reciente',
          ).status,
        ).toBe('FAIL');
      },
    );

    test(
      'falla si falta un comando obligatorio de preflight',
      () => {
        const root =
          createReadyFixture();

        const packagePath =
          join(root, 'package.json');

        const packageJson =
          JSON.parse(
            readFileSync(
              packagePath,
              'utf8',
            ),
          );

        delete packageJson.scripts['backup:verify'];

        writeFileSync(
          packagePath,
          JSON.stringify(
            packageJson,
            null,
            2,
          ),
          'utf8',
        );

        const report =
          inspectReleaseReadiness({
            root,
            nodeVersion: '24.19.0',
          });

        expect(report.status).toBe('FAIL');
      },
    );
  },
);
