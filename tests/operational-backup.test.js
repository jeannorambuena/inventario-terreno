import {
  createHash,
} from 'node:crypto';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import {
  openDatabase,
} from '../src/database/connection.js';

import {
  createOperationalBackup,
  latestOperationalBackup,
  verifyOperationalBackup,
} from '../src/database/operational-backup.js';


let root;
let databasePath;
let evidenceRoot;
let backupRoot;
let importId;
let locationId;
let assetId;


function hash(
  value,
) {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}


beforeEach(() => {
  root =
    mkdtempSync(
      join(
        tmpdir(),
        'inventario-operational-backup-',
      ),
    );

  databasePath =
    join(
      root,
      'inventario.sqlite',
    );

  evidenceRoot =
    join(
      root,
      'evidence-source',
    );

  backupRoot =
    join(
      root,
      'backups',
    );

  mkdirSync(
    evidenceRoot,
    {
      recursive: true,
    },
  );

  const database =
    openDatabase(
      databasePath,
    );

  const inventoryImport =
    database.prepare(`
      INSERT INTO inventory_imports (
        import_code,
        source_name,
        source_checksum,
        sheet_name,
        row_count
      )
      VALUES (
        'backup-import',
        'backup.xlsx',
        'backup-checksum',
        'BD_SQL',
        1
      )
      RETURNING id
    `).get();

  const location =
    database.prepare(`
      INSERT INTO locations (
        location_code,
        name,
        direction,
        department,
        section
      )
      VALUES (
        'BACKUP-LOC',
        'Dependencia backup',
        'Direccion backup',
        'Departamento backup',
        'Seccion backup'
      )
      RETURNING id
    `).get();

  const asset =
    database.prepare(`
      INSERT INTO assets (
        asset_code,
        inventory_import_id,
        location_id,
        name,
        scanner_code
      )
      VALUES (
        'BACKUP-0001',
        ?,
        ?,
        'Bien backup',
        'BACKUP-SCAN'
      )
      RETURNING id
    `).get(
      inventoryImport.id,
      location.id,
    );

  importId =
    inventoryImport.id;

  locationId =
    location.id;

  assetId =
    asset.id;

  database.close();
});


afterEach(() => {
  rmSync(
    root,
    {
      recursive: true,
      force: true,
    },
  );
});


function addHistoricalEvidence() {
  const database =
    openDatabase(
      databasePath,
    );

  const session =
    database.prepare(`
      INSERT INTO inventory_sessions (
        session_code,
        location_id,
        status_code,
        completed_at,
        operator_code,
        device_code
      )
      VALUES (
        'BACKUP-SESSION',
        ?,
        'closed',
        strftime(
          '%Y-%m-%dT%H:%M:%fZ',
          'now'
        ),
        'BACKUP-TEST',
        'NOTEBOOK-BACKUP'
      )
      RETURNING id
    `).get(
      locationId,
    );

  const observation =
    database.prepare(`
      INSERT INTO observations (
        observation_code,
        inventory_session_id,
        asset_id,
        status_code,
        selected_location_id,
        notes,
        observed_at,
        active,
        version_number,
        annulled_at
      )
      VALUES (
        'BACKUP-OBS',
        ?,
        ?,
        'dato_distinto',
        ?,
        '',
        strftime(
          '%Y-%m-%dT%H:%M:%fZ',
          'now'
        ),
        0,
        1,
        strftime(
          '%Y-%m-%dT%H:%M:%fZ',
          'now'
        )
      )
      RETURNING id
    `).get(
      session.id,
      assetId,
      locationId,
    );

  const relativePath =
    'session-historical/photo.jpg';

  const directory =
    join(
      evidenceRoot,
      'session-historical',
    );

  mkdirSync(
    directory,
    {
      recursive: true,
    },
  );

  const payload =
    Buffer.from(
      'historical-evidence',
    );

  writeFileSync(
    join(
      directory,
      'photo.jpg',
    ),
    payload,
  );

  database.prepare(`
    INSERT INTO evidence_files (
      evidence_code,
      inventory_session_id,
      observation_id,
      evidence_type,
      relative_path,
      mime_type,
      byte_size,
      sha256,
      active,
      annulled_at
    )
    VALUES (
      'BACKUP-EVIDENCE',
      ?,
      ?,
      'bien_completo',
      ?,
      'image/jpeg',
      ?,
      ?,
      0,
      strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        'now'
      )
    )
  `).run(
    session.id,
    observation.id,
    relativePath,
    payload.length,
    hash(payload),
  );

  database.close();

  return {
    relativePath,
    payload,
  };
}


describe(
  'operational backup',
  () => {
    test(
      'creates sqlite backup with manifest and sha256',
      async () => {
        const result =
          await createOperationalBackup({
            sourcePath:
              databasePath,
            evidenceRoot,
            backupRoot,
            now:
              new Date(
                '2026-08-19T12:00:00.000Z',
              ),
          });

        expect(
          result.verification.status,
        ).toBe('PASS');

        expect(
          existsSync(
            join(
              result.backupDir,
              'inventario.sqlite',
            ),
          ),
        ).toBe(true);

        expect(
          result.manifest
            .database.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          result.manifest.counts.assets,
        ).toBe(1);
      },
    );


    test(
      'copies historical referenced evidence too',
      async () => {
        const evidence =
          addHistoricalEvidence();

        const result =
          await createOperationalBackup({
            sourcePath:
              databasePath,
            evidenceRoot,
            backupRoot,
            now:
              new Date(
                '2026-08-19T12:01:00.000Z',
              ),
          });

        const copied =
          join(
            result.backupDir,
            'evidence',
            ...evidence.relativePath
              .split('/'),
          );

        expect(
          existsSync(copied),
        ).toBe(true);

        expect(
          readFileSync(copied),
        ).toEqual(
          evidence.payload,
        );

        expect(
          result.manifest
            .evidence.count,
        ).toBe(1);
      },
    );


    test(
      'verifies a coherent operational backup',
      async () => {
        addHistoricalEvidence();

        const result =
          await createOperationalBackup({
            sourcePath:
              databasePath,
            evidenceRoot,
            backupRoot,
            now:
              new Date(
                '2026-08-19T12:02:00.000Z',
              ),
          });

        const verification =
          verifyOperationalBackup(
            result.backupDir,
          );

        expect(
          verification.status,
        ).toBe('PASS');

        expect(
          verification.checks.every(
            ({ status }) =>
              status === 'PASS',
          ),
        ).toBe(true);
      },
    );


    test(
      'detects evidence tampering in backup',
      async () => {
        const evidence =
          addHistoricalEvidence();

        const result =
          await createOperationalBackup({
            sourcePath:
              databasePath,
            evidenceRoot,
            backupRoot,
            now:
              new Date(
                '2026-08-19T12:03:00.000Z',
              ),
          });

        const copied =
          join(
            result.backupDir,
            'evidence',
            ...evidence.relativePath
              .split('/'),
          );

        writeFileSync(
          copied,
          Buffer.from(
            'tampered',
          ),
        );

        const verification =
          verifyOperationalBackup(
            result.backupDir,
          );

        expect(
          verification.status,
        ).toBe('FAIL');

        expect(
          verification.checks.some(
            (check) =>
              check.name
                === 'Evidencia 1'
              && check.status
                === 'FAIL',
          ),
        ).toBe(true);
      },
    );


    test(
      'finds latest operational backup',
      async () => {
        await createOperationalBackup({
          sourcePath:
            databasePath,
          evidenceRoot,
          backupRoot,
          now:
            new Date(
              '2026-08-19T12:04:00.000Z',
            ),
        });

        const latestResult =
          await createOperationalBackup({
            sourcePath:
              databasePath,
          evidenceRoot,
          backupRoot,
          now:
            new Date(
              '2026-08-19T12:05:00.000Z',
            ),
        });

        expect(
          latestOperationalBackup(
            backupRoot,
          ),
        ).toBe(
          latestResult.backupDir,
        );
      },
    );
  },
);
