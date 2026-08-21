import {
  createHash,
} from 'node:crypto';

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

import {
  dirname,
  join,
  resolve,
  sep,
} from 'node:path';

import {
  pathToFileURL,
} from 'node:url';

import Database from 'better-sqlite3';

import {
  getDatabasePath,
} from './connection.js';

import {
  verifyFieldIntegrity,
} from '../field-integrity.js';


function timestamp(
  date = new Date(),
) {
  return date
    .toISOString()
    .replace(
      /[-:.]/g,
      '',
    )
    .replace(
      'T',
      '-',
    );
}


function sha256File(
  filePath,
) {
  return createHash('sha256')
    .update(
      readFileSync(filePath),
    )
    .digest('hex');
}


function safeEvidencePath(
  root,
  relativePath,
) {
  const text =
    String(relativePath ?? '')
      .replaceAll(
        '\\',
        '/',
      );

  if (
    !text
    || text.startsWith('/')
    || text.includes('\0')
  ) {
    throw new Error(
      'Ruta de evidencia invalida.',
    );
  }

  const rootPath =
    resolve(root);

  const destination =
    resolve(
      rootPath,
      text,
    );

  const prefix =
    `${rootPath}${sep}`;

  if (
    destination !== rootPath
    && !destination.startsWith(prefix)
  ) {
    throw new Error(
      'Ruta de evidencia fuera de la raiz.',
    );
  }

  return destination;
}


function scalar(
  database,
  sql,
) {
  return Number(
    database.prepare(sql)
      .get()
      .count,
  ) || 0;
}


function databaseCounts(
  database,
) {
  return {
    imports:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM inventory_imports',
      ),

    locations:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM locations',
      ),

    assets:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM assets',
      ),

    observations:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM observations',
      ),

    activeObservations:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM observations WHERE active = 1',
      ),

    evidenceRecords:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM evidence_files',
      ),

    activeEvidence:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM evidence_files WHERE active = 1',
      ),

    auditRecords:
      scalar(
        database,
        'SELECT COUNT(*) AS count FROM audit_log',
      ),
  };
}


function compareDatabaseCounts(
  actual,
  expected,
) {
  const differences = [];

  for (const [name, value] of Object.entries(expected || {})) {
    if (Number(actual[name]) !== Number(value)) {
      differences.push({
        name,
        expected: Number(value),
        actual: Number(actual[name]),
      });
    }
  }

  return differences;
}


function directoryHasEntries(
  directory,
) {
  return existsSync(directory)
    && readdirSync(directory).length > 0;
}


function referencedEvidence(
  database,
) {
  return database.prepare(`
    SELECT
      id,
      evidence_code AS evidenceCode,
      relative_path AS relativePath,
      byte_size AS byteSize,
      sha256,
      active
    FROM evidence_files
    ORDER BY id
  `).all();
}


async function backupSqlite(
  sourcePath,
  destinationPath,
) {
  const source =
    new Database(
      sourcePath,
      {
        readonly: true,
        fileMustExist: true,
      },
    );

  try {
    await source.backup(
      destinationPath,
    );
  } finally {
    source.close();
  }
}


export function latestOperationalBackup(
  backupRoot = resolve(
    'backups',
    'operational',
  ),
) {
  if (!existsSync(backupRoot)) {
    return null;
  }

  const directories =
    readdirSync(
      backupRoot,
      {
        withFileTypes: true,
      },
    )
      .filter(
        (entry) =>
          entry.isDirectory()
          && entry.name.startsWith(
            'backup-',
          ),
      )
      .map(
        ({ name }) => name,
      )
      .sort();

  const latest =
    directories.at(-1);

  return latest
    ? join(
      backupRoot,
      latest,
    )
    : null;
}


export async function createOperationalBackup({
  sourcePath =
    getDatabasePath(),

  evidenceRoot =
    resolve('evidence'),

  backupRoot =
    resolve(
      'backups',
      'operational',
    ),

  now =
    new Date(),
} = {}) {
  const backupDir =
    join(
      backupRoot,
      `backup-${timestamp(now)}`,
    );

  if (existsSync(backupDir)) {
    throw new Error(
      'El directorio de respaldo ya existe.',
    );
  }

  mkdirSync(
    backupDir,
    {
      recursive: true,
    },
  );

  const backupDatabase =
    join(
      backupDir,
      'inventario.sqlite',
    );

  const backupEvidenceRoot =
    join(
      backupDir,
      'evidence',
    );

  mkdirSync(
    backupEvidenceRoot,
    {
      recursive: true,
    },
  );

  await backupSqlite(
    sourcePath,
    backupDatabase,
  );

  const snapshot =
    new Database(
      backupDatabase,
      {
        readonly: true,
        fileMustExist: true,
      },
    );

  let counts;
  let evidenceRows;

  try {
    counts =
      databaseCounts(snapshot);

    evidenceRows =
      referencedEvidence(snapshot);
  } finally {
    snapshot.close();
  }

  const evidenceFiles = [];

  for (
    const record
    of evidenceRows
  ) {
    const source =
      safeEvidencePath(
        evidenceRoot,
        record.relativePath,
      );

    const destination =
      safeEvidencePath(
        backupEvidenceRoot,
        record.relativePath,
      );

    if (!existsSync(source)) {
      evidenceFiles.push({
        id: record.id,
        evidenceCode:
          record.evidenceCode,
        relativePath:
          record.relativePath,
        active:
          Boolean(record.active),
        expectedByteSize:
          record.byteSize,
        expectedSha256:
          record.sha256,
        state:
          'missing',
      });

      continue;
    }

    mkdirSync(
      dirname(destination),
      {
        recursive: true,
      },
    );

    copyFileSync(
      source,
      destination,
    );

    const copiedByteSize =
      statSync(destination).size;

    const copiedSha256 =
      sha256File(destination);

    const state =
      copiedByteSize
        === Number(record.byteSize)
      && copiedSha256
        === record.sha256
        ? 'available'
        : 'invalid';

    evidenceFiles.push({
      id: record.id,
      evidenceCode:
        record.evidenceCode,
      relativePath:
        record.relativePath,
      active:
        Boolean(record.active),
      expectedByteSize:
        record.byteSize,
      expectedSha256:
        record.sha256,
      copiedByteSize,
      copiedSha256,
      state,
    });
  }

  const databaseStat =
    statSync(
      backupDatabase,
    );

  const evidenceOk =
    evidenceFiles.every(
      ({ state }) =>
        state === 'available',
    );

  const manifest = {
    schemaVersion: 1,

    createdAt:
      now.toISOString(),

    kind:
      'inventario-terreno-operational-backup',

    database: {
      file:
        'inventario.sqlite',

      byteSize:
        databaseStat.size,

      sha256:
        sha256File(
          backupDatabase,
        ),
    },

    evidence: {
      root:
        'evidence',

      count:
        evidenceFiles.length,

      files:
        evidenceFiles,
    },

    counts,

    copyStatus:
      evidenceOk
        ? 'PASS'
        : 'FAIL',
  };

  writeFileSync(
    join(
      backupDir,
      'manifest.json',
    ),

    JSON.stringify(
      manifest,
      null,
      2,
    ) + '\n',

    'utf8',
  );

  const verification =
    verifyOperationalBackup(
      backupDir,
    );

  return {
    backupDir,
    manifest,
    verification,
  };
}


export function verifyOperationalBackup(
  backupDir,
) {
  const root =
    resolve(backupDir);

  const manifestPath =
    join(
      root,
      'manifest.json',
    );

  if (!existsSync(manifestPath)) {
    return {
      status: 'FAIL',
      checks: [
        {
          name:
            'Manifest',
          status:
            'FAIL',
          detail:
            'manifest.json no existe.',
        },
      ],
    };
  }

  const checks = [];

  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return {
      status: 'FAIL',
      checks: [{
        name: 'Manifest',
        status: 'FAIL',
        detail: `manifest.json invalido: ${error.message}`,
      }],
    };
  }

  const manifestShapeOk = Boolean(
    manifest
    && manifest.database?.file
    && Number.isFinite(Number(manifest.database?.byteSize))
    && /^[a-f0-9]{64}$/i.test(String(manifest.database?.sha256 || ''))
    && manifest.evidence?.root
    && Array.isArray(manifest.evidence?.files)
    && manifest.counts
    && typeof manifest.counts === 'object',
  );

  checks.push({
    name: 'Forma del manifest',
    status: manifestShapeOk ? 'PASS' : 'FAIL',
    detail: manifestShapeOk
      ? 'manifest.json contiene base, evidencias y conteos.'
      : 'manifest.json no contiene la estructura operacional requerida.',
  });

  if (!manifestShapeOk) {
    return { status: 'FAIL', checks, manifest };
  }

  checks.push({
    name: 'Cantidad declarada de evidencias',
    status: Number(manifest.evidence.count) === manifest.evidence.files.length ? 'PASS' : 'FAIL',
    detail: `${manifest.evidence.files.length} declaracion(es) en manifest.`,
  });

  const declaredEvidencePaths = manifest.evidence.files
    .map(({ relativePath }) => String(relativePath ?? '').replaceAll('\\', '/'));
  const uniqueEvidencePaths = new Set(declaredEvidencePaths);
  checks.push({
    name: 'Rutas unicas de evidencia',
    status: uniqueEvidencePaths.size === declaredEvidencePaths.length ? 'PASS' : 'FAIL',
    detail: uniqueEvidencePaths.size === declaredEvidencePaths.length
      ? 'No existen rutas de evidencia duplicadas.'
      : 'El manifest contiene rutas de evidencia duplicadas.',
  });

  let databasePath;

  let evidenceRoot;

  try {
    databasePath = safeEvidencePath(root, manifest.database.file);
    evidenceRoot = safeEvidencePath(root, manifest.evidence.root);
  } catch (error) {
    checks.push({
      name: 'Rutas del manifest',
      status: 'FAIL',
      detail: error.message,
    });
    return { status: 'FAIL', checks, manifest };
  }

  let database = null;
  let fieldIntegrity = null;

  const databaseExists =
    existsSync(databasePath);

  checks.push({
    name:
      'SQLite presente',

    status:
      databaseExists
        ? 'PASS'
        : 'FAIL',

    detail:
      databaseExists
        ? 'Archivo SQLite disponible.'
        : 'Archivo SQLite ausente.',
  });

  if (databaseExists) {
    const size =
      statSync(
        databasePath,
      ).size;

    const hash =
      sha256File(
        databasePath,
      );

    checks.push({
      name:
        'SQLite SHA-256',

      status:
        size
          === Number(
            manifest.database.byteSize,
          )
        && hash
          === manifest.database.sha256
          ? 'PASS'
          : 'FAIL',

      detail:
        hash,
    });

    try {
      database =
        new Database(
          databasePath,
          {
            readonly: true,
            fileMustExist: true,
          },
        );

      const integrity =
        database.pragma(
          'integrity_check',
          {
            simple: true,
          },
        );

      checks.push({
        name:
          'SQLite integrity_check',

        status:
          integrity === 'ok'
            ? 'PASS'
            : 'FAIL',

        detail:
          String(integrity),
      });

      const foreignKeyRows = database.pragma('foreign_key_check');

      checks.push({
        name: 'SQLite foreign_key_check',
        status: foreignKeyRows.length === 0 ? 'PASS' : 'FAIL',
        detail: foreignKeyRows.length === 0
          ? 'Sin referencias foraneas rotas.'
          : `${foreignKeyRows.length} referencia(s) foranea(s) rota(s).`,
      });

      const counts = databaseCounts(database);
      const countDifferences = compareDatabaseCounts(counts, manifest.counts);

      checks.push({
        name: 'Conteos del manifest',
        status: countDifferences.length === 0 ? 'PASS' : 'FAIL',
        detail: countDifferences.length === 0
          ? 'Los conteos SQLite coinciden con manifest.json.'
          : JSON.stringify(countDifferences),
      });

      const evidenceIds = database.prepare(`
        SELECT id FROM evidence_files ORDER BY id
      `).all().map(({ id }) => Number(id));
      const manifestEvidenceIds = manifest.evidence.files
        .map(({ id }) => Number(id))
        .sort((left, right) => left - right);
      const declarationsMatch = evidenceIds.length === manifestEvidenceIds.length
        && evidenceIds.every((id, index) => id === manifestEvidenceIds[index]);

      checks.push({
        name: 'Declaraciones de evidencia',
        status: declarationsMatch ? 'PASS' : 'FAIL',
        detail: declarationsMatch
          ? 'Cada registro SQLite tiene una declaracion en manifest.'
          : 'Los ids de evidencia SQLite y manifest no coinciden.',
      });

    } catch (error) {
      checks.push({
        name:
          'SQLite apertura',

        status:
          'FAIL',

        detail:
          error.message,
      });
    }
  }

  for (
    const file
    of manifest.evidence.files
  ) {
    let path;

    try {
      path =
        safeEvidencePath(
          evidenceRoot,
          file.relativePath,
        );
    } catch (error) {
      checks.push({
        name:
          `Evidencia ${file.id}`,

        status:
          'FAIL',

        detail:
          error.message,
      });

      continue;
    }

    if (!existsSync(path)) {
      checks.push({
        name:
          `Evidencia ${file.id}`,

        status:
          'FAIL',

        detail:
          'Archivo ausente.',
      });

      continue;
    }

    const size =
      statSync(path).size;

    const hash =
      sha256File(path);

    checks.push({
      name:
        `Evidencia ${file.id}`,

      status:
        size
          === Number(
            file.expectedByteSize,
          )
        && hash
          === file.expectedSha256
          ? 'PASS'
          : 'FAIL',

      detail:
        hash,
    });
  }

  if (database) {
    try {
      fieldIntegrity =
        verifyFieldIntegrity(
          database,
          {
            evidenceRoot,
            verifyHashes:
              true,
          },
        );

      checks.push({
        name:
          'Integridad operacional restaurada',

        status:
          fieldIntegrity.status
            === 'PASS'
          && fieldIntegrity.warnings === 0
            ? 'PASS'
            : 'FAIL',

        detail:
          `${fieldIntegrity.status}; advertencias=${fieldIntegrity.warnings}`,
      });

    } catch (error) {
      checks.push({
        name:
          'Integridad operacional restaurada',

        status:
          'FAIL',

        detail:
          error.message,
      });

    } finally {
      database.close();
    }
  }

  return {
    status:
      checks.every(
        ({ status }) =>
          status === 'PASS',
      )
        ? 'PASS'
        : 'FAIL',

    checks,

    fieldIntegrity,

    manifest,
  };
}


export function verifyRestoredInstallation(
  targetRoot,
  manifest,
) {
  const root = resolve(targetRoot);
  const databasePath = resolve(root, 'data', 'inventario.sqlite');
  const evidenceRoot = resolve(root, 'evidence');
  const checks = [];
  let counts = null;
  let fieldIntegrity = null;

  const databaseExists = existsSync(databasePath);
  checks.push({
    name: 'SQLite restaurada presente',
    status: databaseExists ? 'PASS' : 'FAIL',
    detail: databaseExists ? databasePath : 'Archivo ausente.',
  });

  if (databaseExists) {
    const size = statSync(databasePath).size;
    const hash = sha256File(databasePath);
    checks.push({
      name: 'SQLite restaurada SHA-256',
      status: size === Number(manifest.database.byteSize)
        && hash === manifest.database.sha256 ? 'PASS' : 'FAIL',
      detail: hash,
    });

    let database;
    try {
      database = new Database(databasePath, { readonly: true, fileMustExist: true });
      const integrity = database.pragma('integrity_check', { simple: true });
      checks.push({
        name: 'SQLite restaurada integrity_check',
        status: integrity === 'ok' ? 'PASS' : 'FAIL',
        detail: String(integrity),
      });
      const foreignKeys = database.pragma('foreign_key_check');
      checks.push({
        name: 'SQLite restaurada foreign_key_check',
        status: foreignKeys.length === 0 ? 'PASS' : 'FAIL',
        detail: foreignKeys.length === 0
          ? 'Sin referencias foraneas rotas.'
          : `${foreignKeys.length} referencia(s) rota(s).`,
      });
      counts = databaseCounts(database);
      const differences = compareDatabaseCounts(counts, manifest.counts);
      checks.push({
        name: 'Conteos restaurados',
        status: differences.length === 0 ? 'PASS' : 'FAIL',
        detail: differences.length === 0
          ? 'Coinciden con manifest.json.'
          : JSON.stringify(differences),
      });
      fieldIntegrity = verifyFieldIntegrity(database, { evidenceRoot, verifyHashes: true });
      checks.push({
        name: 'Integridad de campo restaurada',
        status: fieldIntegrity.status === 'PASS' && fieldIntegrity.warnings === 0 ? 'PASS' : 'FAIL',
        detail: `${fieldIntegrity.status}; advertencias=${fieldIntegrity.warnings}`,
      });
    } catch (error) {
      checks.push({
        name: 'Apertura SQLite restaurada',
        status: 'FAIL',
        detail: error.message,
      });
    } finally {
      database?.close();
    }
  }

  for (const file of manifest.evidence.files) {
    let evidencePath;
    try {
      evidencePath = safeEvidencePath(evidenceRoot, file.relativePath);
    } catch (error) {
      checks.push({ name: `Evidencia restaurada ${file.id}`, status: 'FAIL', detail: error.message });
      continue;
    }
    if (!existsSync(evidencePath)) {
      checks.push({ name: `Evidencia restaurada ${file.id}`, status: 'FAIL', detail: 'Archivo ausente.' });
      continue;
    }
    const size = statSync(evidencePath).size;
    const hash = sha256File(evidencePath);
    checks.push({
      name: `Evidencia restaurada ${file.id}`,
      status: size === Number(file.expectedByteSize)
        && hash === file.expectedSha256 ? 'PASS' : 'FAIL',
      detail: hash,
    });
  }

  return {
    status: checks.every(({ status }) => status === 'PASS') ? 'PASS' : 'FAIL',
    checks,
    counts,
    fieldIntegrity,
    databasePath,
    evidenceRoot,
  };
}


export function restoreOperationalBackup({
  backupDir,
  targetRoot,
  confirm = false,
} = {}) {
  if (!confirm) {
    throw new Error('La restauracion requiere confirmacion explicita (--confirm).');
  }
  if (!backupDir || !targetRoot) {
    throw new Error('Indique directorio de backup y raiz de instalacion destino.');
  }

  const sourceRoot = resolve(backupDir);
  const destinationRoot = resolve(targetRoot);
  const verification = verifyOperationalBackup(sourceRoot);
  if (verification.status !== 'PASS') {
    throw new Error('El backup fuente no supera la verificacion completa.');
  }

  const manifest = verification.manifest;
  const targetData = resolve(destinationRoot, 'data');
  const targetDatabase = resolve(targetData, 'inventario.sqlite');
  const targetEvidence = resolve(destinationRoot, 'evidence');
  const destinationPrefix = `${destinationRoot}${sep}`;
  for (const path of [targetData, targetDatabase, targetEvidence]) {
    if (!path.startsWith(destinationPrefix)) {
      throw new Error('Ruta destino fuera de la raiz de instalacion.');
    }
  }

  if (existsSync(targetDatabase)) {
    throw new Error('Restauracion rechazada: TARGET\\data\\inventario.sqlite ya existe.');
  }
  if (directoryHasEntries(targetData)) {
    throw new Error('Restauracion rechazada: TARGET\\data contiene archivos.');
  }
  if (directoryHasEntries(targetEvidence)) {
    throw new Error('Restauracion rechazada: TARGET\\evidence contiene datos.');
  }

  mkdirSync(destinationRoot, { recursive: true });
  const stagingRoot = resolve(destinationRoot, `.restore-staging-${process.pid}-${Date.now()}`);
  if (!stagingRoot.startsWith(destinationPrefix) || existsSync(stagingRoot)) {
    throw new Error('No fue posible reservar staging seguro de restauracion.');
  }
  const stagingData = resolve(stagingRoot, 'data');
  const stagingDatabase = resolve(stagingData, 'inventario.sqlite');
  const stagingEvidence = resolve(stagingRoot, 'evidence');
  const originalDataDirectory = existsSync(targetData);
  const originalEvidenceDirectory = existsSync(targetEvidence);
  let dataCommitted = false;
  let evidenceCommitted = false;

  try {
    mkdirSync(stagingData, { recursive: true });
    mkdirSync(stagingEvidence, { recursive: true });
    copyFileSync(safeEvidencePath(sourceRoot, manifest.database.file), stagingDatabase);
    const sourceEvidenceRoot = safeEvidencePath(sourceRoot, manifest.evidence.root);
    for (const file of manifest.evidence.files) {
      const source = safeEvidencePath(sourceEvidenceRoot, file.relativePath);
      const destination = safeEvidencePath(stagingEvidence, file.relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }

    const staged = verifyRestoredInstallation(stagingRoot, manifest);
    if (staged.status !== 'PASS') {
      throw new Error('El contenido restaurado en staging no supera la verificacion.');
    }

    if (directoryHasEntries(targetData) || directoryHasEntries(targetEvidence) || existsSync(targetDatabase)) {
      throw new Error('El destino cambio durante la restauracion; no se aplicaron datos.');
    }
    if (existsSync(targetData)) rmSync(targetData, { recursive: true });
    if (existsSync(targetEvidence)) rmSync(targetEvidence, { recursive: true });

    renameSync(stagingEvidence, targetEvidence);
    evidenceCommitted = true;
    renameSync(stagingData, targetData);
    dataCommitted = true;

    const restored = verifyRestoredInstallation(destinationRoot, manifest);
    if (restored.status !== 'PASS') {
      throw new Error('La instalacion restaurada no supera la verificacion posterior.');
    }

    rmSync(stagingRoot, { recursive: true, force: true });
    return {
      status: 'PASS',
      backupDir: sourceRoot,
      targetRoot: destinationRoot,
      manifest,
      verification: restored,
    };
  } catch (error) {
    if (dataCommitted && existsSync(targetData)) renameSync(targetData, stagingData);
    if (evidenceCommitted && existsSync(targetEvidence)) renameSync(targetEvidence, stagingEvidence);
    if (originalDataDirectory) mkdirSync(targetData, { recursive: true });
    if (originalEvidenceDirectory) mkdirSync(targetEvidence, { recursive: true });
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}


async function runCli() {
  const action =
    process.argv[2]
    || 'create';

  if (action === 'create') {
    const result =
      await createOperationalBackup({
        sourcePath:
          resolve(
            process.env.INVENTARIO_DB_PATH
            || getDatabasePath(),
          ),

        evidenceRoot:
          resolve(
            process.env.INVENTARIO_EVIDENCE_ROOT
            || 'evidence',
          ),

        backupRoot:
          resolve(
            process.env.INVENTARIO_BACKUP_ROOT
            || join(
              'backups',
              'operational',
            ),
          ),
      });

    console.log('');
    console.log(
      '=== RESPALDO OPERACIONAL ===',
    );

    console.log(
      `Directorio: ${result.backupDir}`,
    );

    console.log(
      `SQLite SHA-256: ${
        result.manifest.database.sha256
      }`,
    );

    console.log(
      `Evidencias: ${
        result.manifest.evidence.count
      }`,
    );

    console.log(
      `RESPALDO OPERACIONAL: ${
        result.verification.status
      }`,
    );

    if (
      result.verification.status
      !== 'PASS'
    ) {
      process.exitCode = 1;
    }

    return;
  }

  if (action === 'verify-latest' || action === 'verify') {
    const backupRoot =
      resolve(
        process.env.INVENTARIO_BACKUP_ROOT
        || join(
          'backups',
          'operational',
        ),
      );

    const requested = action === 'verify'
      ? process.argv[3]
      : null;

    if (action === 'verify' && !requested) {
      throw new Error('Indique la ruta del backup que desea verificar.');
    }

    const latest = requested
      ? resolve(requested)
      : latestOperationalBackup(backupRoot);

    if (!latest) {
      console.error(
        'RESPALDO OPERACIONAL: FAIL',
      );

      console.error(
        'No existe un respaldo operacional.',
      );

      process.exitCode = 1;
      return;
    }

    const result =
      verifyOperationalBackup(
        latest,
      );

    console.log('');
    console.log(
      '=== VERIFICACION DE RESPALDO ===',
    );

    console.log(
      `Directorio: ${latest}`,
    );

    for (
      const check
      of result.checks
    ) {
      console.log(
        `[${check.status}] `
        + `${check.name} - `
        + `${check.detail}`,
      );
    }

    console.log('');
    console.log(
      `RESPALDO VERIFICADO: ${
        result.status
      }`,
    );

    if (result.status !== 'PASS') {
      process.exitCode = 1;
    }

    return;
  }

  if (action === 'restore') {
    const backupDir = process.argv[3];
    const targetRoot = process.argv[4];
    const confirm = process.argv.includes('--confirm');
    const result = restoreOperationalBackup({ backupDir, targetRoot, confirm });

    console.log('');
    console.log('=== RESTAURACION OPERACIONAL ===');
    console.log(`Backup: ${result.backupDir}`);
    console.log(`Destino: ${result.targetRoot}`);
    console.log(`SQLite: ${result.verification.databasePath}`);
    console.log(`Evidencias: ${result.manifest.evidence.count}`);
    console.log(`RESTAURACION OPERACIONAL: ${result.status}`);
    return;
  }

  console.error(
    'Accion invalida. Use create, verify-latest, verify "RUTA" o restore "BACKUP" "TARGET" --confirm.',
  );

  process.exitCode = 1;
}


const entryPoint =
  process.argv[1]
    ? pathToFileURL(
      resolve(
        process.argv[1],
      ),
    ).href
    : undefined;


if (entryPoint === import.meta.url) {
  try {
    await runCli();
  } catch (error) {
    console.error('');
    console.error('OPERACION DE RESPALDO: FAIL');
    console.error(error.message);
    process.exitCode = 1;
  }
}
