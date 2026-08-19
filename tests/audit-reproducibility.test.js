import {
  createHash,
} from 'node:crypto';

import {
  readFileSync,
} from 'node:fs';

import request from 'supertest';

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
  createApp,
} from '../src/server.js';


const html =
  readFileSync(
    new URL(
      '../public/reports.html',
      import.meta.url,
    ),
    'utf8',
  );

const js =
  readFileSync(
    new URL(
      '../public/reports.js',
      import.meta.url,
    ),
    'utf8',
  );


function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(
      canonical,
    );
  }

  if (
    value
    && typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          (key) => [
            key,
            canonical(
              value[key],
            ),
          ],
        ),
    );
  }

  return value;
}


function digest(value) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical(value),
      ),
    )
    .digest('hex');
}


let database;
let app;
let locationId;
let assetId;


beforeEach(() => {
  database =
    openDatabase(':memory:');

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
        'repro-import',
        'repro.xlsx',
        'repro-checksum',
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
        'REPRO-LOC',
        'Dependencia reproducible',
        'Direccion reproducible',
        'Departamento reproducible',
        'Seccion reproducible'
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
        'REPRO-0001',
        ?,
        ?,
        'Bien reproducible',
        'REPRO-SCAN'
      )
      RETURNING id
    `).get(
      inventoryImport.id,
      location.id,
    );

  locationId =
    location.id;

  assetId =
    asset.id;

  app =
    createApp({
      database,
    });
});


afterEach(() => {
  database.close();
});


async function createSession() {
  const created =
    await request(app)
      .post('/api/sessions')
      .send({
        locationId,
        operatorCode:
          'REPRO-TEST',
        deviceCode:
          'NOTEBOOK-REPRO',
      })
      .expect(201);

  const sessionId =
    created.body.session.id;

  await request(app)
    .post(
      `/api/sessions/${sessionId}/observations`,
    )
    .send({
      assetId,
      status:
        'verificado',
      locationId,
      observation:
        '',
      operatorCode:
        'REPRO-TEST',
      deviceCode:
        'NOTEBOOK-REPRO',
    })
    .expect(201);

  return sessionId;
}


describe(
  'expediente reproducible',
  () => {
    test(
      'same state produces same digest',
      async () => {
        const sessionId =
          await createSession();

        const first =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        const second =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        expect(
          first.body.package
            .manifest.digestSha256,
        ).toBe(
          second.body.package
            .manifest.digestSha256,
        );
      },
    );


    test(
      'generatedAt is outside digest manifest',
      async () => {
        const sessionId =
          await createSession();

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        const packageData =
          response.body.package;

        expect(
          packageData.manifest.generatedAt,
        ).toBeTruthy();

        expect(
          packageData.verification.manifest,
        ).not.toHaveProperty(
          'generatedAt',
        );
      },
    );


    test(
      'verification digest can be independently recomputed',
      async () => {
        const sessionId =
          await createSession();

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        const verification =
          response.body.package.verification;

        const calculated =
          digest({
            manifest:
              verification.manifest,
            snapshot:
              verification.snapshot,
          });

        expect(
          calculated,
        ).toBe(
          verification.digestSha256,
        );

        expect(
          calculated,
        ).toBe(
          response.body.package
            .manifest.digestSha256,
        );
      },
    );


    test(
      'real state change changes digest',
      async () => {
        const sessionId =
          await createSession();

        const first =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        database.prepare(`
          INSERT INTO audit_log (
            entity_type,
            entity_code,
            action_code,
            inventory_session_id,
            operator_code,
            device_code,
            details_json
          )
          VALUES (
            'session',
            ?,
            'synthetic_state_change',
            ?,
            'REPRO-TEST',
            'NOTEBOOK-REPRO',
            '{}'
          )
        `).run(
          String(sessionId),
          sessionId,
        );

        const second =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        expect(
          second.body.package
            .manifest.digestSha256,
        ).not.toBe(
          first.body.package
            .manifest.digestSha256,
        );
      },
    );


    test(
      'dashboard downloads verifiable json',
      () => {
        expect(html).toContain(
          'id="download-audit-manifest"',
        );

        expect(js).toContain(
          'function downloadAuditManifest()',
        );

        expect(js).toContain(
          'packageData.verification',
        );

        expect(js).toContain(
          'application/json;charset=utf-8',
        );
      },
    );
  },
);
