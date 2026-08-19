import {
  createHash,
} from 'node:crypto';

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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

  const manifest =
    JSON.parse(
      readFileSync(
        manifestPath,
        'utf8',
      ),
    );

  const checks = [];

  const databasePath =
    join(
      root,
      manifest.database.file,
    );

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

  const evidenceRoot =
    join(
      root,
      manifest.evidence.root,
    );

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
            ? 'PASS'
            : 'FAIL',

        detail:
          fieldIntegrity.status,
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
  };
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

  if (action === 'verify-latest') {
    const backupRoot =
      resolve(
        process.env.INVENTARIO_BACKUP_ROOT
        || join(
          'backups',
          'operational',
        ),
      );

    const latest =
      latestOperationalBackup(
        backupRoot,
      );

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

  console.error(
    'Accion invalida. Use create o verify-latest.',
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
  await runCli();
}
