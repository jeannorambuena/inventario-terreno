import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';

import {
  join,
  resolve,
} from 'node:path';

import {
  pathToFileURL,
} from 'node:url';


const REQUIRED_FILES = Object.freeze([
  'README.md',
  'AGENTS.md',
  'scripts/verify-field-integrity.js',
  'src/database/operational-backup.js',
  'docs/ACEPTACION-PILOTO.md',
  'docs/OPERACION-DIARIA.md',
  'docs/RELEASE-1.0.md',
]);

const REQUIRED_SCRIPTS = Object.freeze([
  'test',
  'verify:field',
  'backup:operational',
  'backup:verify',
  'release:check',
  'pilot:preflight',
]);

const PRIVATE_IGNORE_ENTRIES = Object.freeze([
  'data/',
  'evidence/',
  'backups/',
  'imports/',
  'exports/',
  'local-certs/',
]);

const README_MARKERS = Object.freeze([
  'docs/ACEPTACION-PILOTO.md',
  'docs/OPERACION-DIARIA.md',
  'docs/RELEASE-1.0.md',
  'pilot:preflight',
]);


function readJson(filePath) {
  return JSON.parse(
    readFileSync(
      filePath,
      'utf8',
    ),
  );
}


function latestBackupDirectory(backupRoot) {
  if (!existsSync(backupRoot)) {
    return null;
  }

  const entries =
    readdirSync(
      backupRoot,
      {
        withFileTypes: true,
      },
    )
      .filter(
        (entry) =>
          entry.isDirectory()
          && entry.name.startsWith('backup-'),
      )
      .map(
        ({ name }) => name,
      )
      .sort();

  const latest = entries.at(-1);

  return latest
    ? join(backupRoot, latest)
    : null;
}


function addCheck(
  checks,
  name,
  condition,
  passDetail,
  failDetail,
) {
  checks.push({
    name,
    status: condition ? 'PASS' : 'FAIL',
    detail: condition
      ? passDetail
      : failDetail,
  });
}


export function inspectReleaseReadiness({
  root = process.cwd(),
  nodeVersion = process.versions.node,
  requireOperationalBackup = true,
} = {}) {
  const projectRoot = resolve(root);
  const checks = [];

  const packagePath =
    join(projectRoot, 'package.json');

  let packageJson = null;

  try {
    packageJson = readJson(packagePath);
  } catch {
    packageJson = null;
  }

  addCheck(
    checks,
    'package.json legible',
    Boolean(packageJson),
    'package.json disponible y JSON valido.',
    'package.json ausente o invalido.',
  );

  const nodeMajor =
    Number(
      String(nodeVersion)
        .split('.')[0],
    );

  addCheck(
    checks,
    'Node.js 24',
    nodeMajor === 24,
    `Node.js ${nodeVersion} compatible.`,
    `Node.js ${nodeVersion} no cumple >=24 <25.`,
  );

  addCheck(
    checks,
    'Version candidata 1.0.0',
    packageJson?.version === '1.0.0',
    'package.json declara version 1.0.0.',
    `Version encontrada: ${packageJson?.version ?? 'sin version'}.`,
  );

  const missingScripts =
    REQUIRED_SCRIPTS.filter(
      (name) =>
        !packageJson?.scripts?.[name],
    );

  addCheck(
    checks,
    'Comandos de cierre',
    missingScripts.length === 0,
    'Scripts de prueba, integridad, respaldo y preflight presentes.',
    `Faltan scripts: ${missingScripts.join(', ') || 'desconocido'}.`,
  );

  const missingFiles =
    REQUIRED_FILES.filter(
      (relativePath) =>
        !existsSync(
          join(
            projectRoot,
            relativePath,
          ),
        ),
    );

  addCheck(
    checks,
    'Documentacion y utilidades de release',
    missingFiles.length === 0,
    'Archivos de aceptacion, operacion y release disponibles.',
    `Faltan archivos: ${missingFiles.join(', ') || 'desconocido'}.`,
  );

  const gitignorePath =
    join(projectRoot, '.gitignore');

  const gitignore =
    existsSync(gitignorePath)
      ? readFileSync(
        gitignorePath,
        'utf8',
      )
      : '';

  const missingIgnores =
    PRIVATE_IGNORE_ENTRIES.filter(
      (entry) =>
        !gitignore.includes(entry),
    );

  addCheck(
    checks,
    'Frontera de datos privados',
    missingIgnores.length === 0,
    'Directorios operacionales privados permanecen ignorados por Git.',
    `Faltan exclusiones: ${missingIgnores.join(', ') || 'desconocido'}.`,
  );

  const readmePath =
    join(projectRoot, 'README.md');

  const readme =
    existsSync(readmePath)
      ? readFileSync(
        readmePath,
        'utf8',
      )
      : '';

  const missingReadmeMarkers =
    README_MARKERS.filter(
      (marker) =>
        !readme.includes(marker),
    );

  addCheck(
    checks,
    'README de piloto y release',
    missingReadmeMarkers.length === 0,
    'README enlaza operacion, aceptacion y release.',
    `README incompleto: ${missingReadmeMarkers.join(', ') || 'desconocido'}.`,
  );

  if (requireOperationalBackup) {
    const backupRoot =
      join(
        projectRoot,
        'backups',
        'operational',
      );

    const latest =
      latestBackupDirectory(backupRoot);

    addCheck(
      checks,
      'Respaldo operacional reciente',
      Boolean(latest),
      latest
        ? `Ultimo respaldo: ${latest}.`
        : 'Respaldo operacional disponible.',
      'No existe respaldo operacional para validar el preflight.',
    );

    if (latest) {
      const manifestPath =
        join(latest, 'manifest.json');

      const databasePath =
        join(latest, 'inventario.sqlite');

      const evidencePath =
        join(latest, 'evidence');

      let manifest = null;

      try {
        manifest = readJson(manifestPath);
      } catch {
        manifest = null;
      }

      const backupShapeOk =
        Boolean(manifest)
        && manifest.kind
          === 'inventario-terreno-operational-backup'
        && manifest.copyStatus === 'PASS'
        && existsSync(databasePath)
        && statSync(databasePath).size > 0
        && existsSync(evidencePath)
        && statSync(evidencePath).isDirectory();

      addCheck(
        checks,
        'Forma del respaldo operacional',
        backupShapeOk,
        'SQLite, evidence/ y manifest.json forman una unidad coherente.',
        'El respaldo mas reciente esta incompleto o su manifiesto no indica PASS.',
      );
    }
  }

  const failures =
    checks.filter(
      ({ status }) =>
        status === 'FAIL',
    ).length;

  return {
    status:
      failures === 0
        ? 'PASS'
        : 'FAIL',
    failures,
    checks,
  };
}


function printReport(report) {
  console.log('');
  console.log('=== RELEASE READINESS INVENTARIO TERRENO ===');
  console.log('');

  for (const check of report.checks) {
    console.log(
      `[${check.status}] ${check.name} - ${check.detail}`,
    );
  }

  console.log('');
  console.log(`RELEASE READINESS: ${report.status}`);

  if (report.failures > 0) {
    console.log(`Fallos: ${report.failures}`);
  }
}


const isDirectRun =
  process.argv[1]
  && import.meta.url
    === pathToFileURL(
      resolve(process.argv[1]),
    ).href;

if (isDirectRun) {
  try {
    const report =
      inspectReleaseReadiness();

    printReport(report);

    if (report.status !== 'PASS') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('');
    console.error('RELEASE READINESS: FAIL');
    console.error(error.message);
    process.exitCode = 1;
  }
}
