import request from 'supertest';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import {
  readFileSync,
} from 'node:fs';

import {
  openDatabase,
} from '../src/database/connection.js';

import {
  createApp,
} from '../src/server.js';


const html = readFileSync(
  new URL(
    '../public/reports.html',
    import.meta.url,
  ),
  'utf8',
);

const js = readFileSync(
  new URL(
    '../public/reports.js',
    import.meta.url,
  ),
  'utf8',
);

const css = readFileSync(
  new URL(
    '../public/reports.css',
    import.meta.url,
  ),
  'utf8',
);

const routes = readFileSync(
  new URL(
    '../src/api/routes.js',
    import.meta.url,
  ),
  'utf8',
);


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
        'package-import',
        'package.xlsx',
        'package-checksum',
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
        'PACKAGE-LOC',
        'Dependencia expediente',
        'Direccion expediente',
        'Departamento expediente',
        'Seccion expediente'
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
        'PACKAGE-0001',
        ?,
        ?,
        'Bien expediente',
        'PACKAGE-SCAN-0001'
      )
      RETURNING id
    `).get(
      inventoryImport.id,
      location.id,
    );

  locationId = location.id;
  assetId = asset.id;

  app =
    createApp({
      database,
    });
});


afterEach(() => {
  database.close();
});


async function createPackageSession() {
  const created =
    await request(app)
      .post('/api/sessions')
      .send({
        locationId,
        operatorCode:
          'AUDITOR-PACKAGE',
        deviceCode:
          'NOTEBOOK-PACKAGE',
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
      status: 'verificado',
      locationId,
      observation: '',
      operatorCode:
        'AUDITOR-PACKAGE',
      deviceCode:
        'NOTEBOOK-PACKAGE',
    })
    .expect(201);

  return sessionId;
}


describe(
  'expediente de auditoria',
  () => {
    test(
      'endpoint genera expediente sin escribir auditoria',
      async () => {
        const sessionId =
          await createPackageSession();

        const before =
          database.prepare(
            'SELECT COUNT(*) AS count FROM audit_log',
          ).get().count;

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        const after =
          database.prepare(
            'SELECT COUNT(*) AS count FROM audit_log',
          ).get().count;

        expect(after).toBe(before);

        expect(
          response.body.package.summary.id,
        ).toBe(sessionId);
      },
    );

    test(
      'manifiesto contiene sha256 del snapshot',
      async () => {
        const sessionId =
          await createPackageSession();

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        expect(
          response.body.package
            .manifest.digestSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          response.body.package
            .manifest.packageCode,
        ).toContain(
          `AUD-S${sessionId}-`,
        );
      },
    );

    test(
      'expediente reporta integridad de evidencias',
      async () => {
        const sessionId =
          await createPackageSession();

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        expect(
          response.body.package
            .evidenceIntegrity,
        ).toMatchObject({
          activeFiles: 0,
          available: 0,
          missing: 0,
          invalid: 0,
          integrityOk: true,
        });
      },
    );

    test(
      'incluye ciclo de vida y auditoria',
      async () => {
        const sessionId =
          await createPackageSession();

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit-package`,
            )
            .expect(200);

        expect(
          response.body.package
            .lifecycle.activeRecords,
        ).toBe(1);

        expect(
          response.body.package.audit.length,
        ).toBeGreaterThanOrEqual(2);
      },
    );

    test(
      'dashboard incluye expediente de seccion',
      () => {
        expect(html).toContain(
          'id="open-audit-package"',
        );

        expect(html).toContain(
          'data-explorer-tab="dossier"',
        );

        expect(html).toContain(
          'id="audit-package-sheet"',
        );
      },
    );

    test(
      'explorador carga audit-package',
      () => {
        expect(js).toContain(
          '`/api/sessions/${section.sessionId}/audit-package`',
        );

        expect(js).toContain(
          'state.explorerAuditPackage',
        );

        expect(js).toContain(
          'renderAuditPackage(',
        );
      },
    );

    test(
      'permite imprimir expediente',
      () => {
        expect(js).toContain(
          'function printAuditPackageView()',
        );

        expect(js).toContain(
          "'print-audit-package'",
        );

        expect(css).toContain(
          'body.print-audit-package',
        );
      },
    );

    test(
      'permite exportar auditoria csv',
      () => {
        expect(html).toContain(
          'id="export-audit-csv"',
        );

        expect(js).toContain(
          'function downloadAuditCsv()',
        );

        expect(js).toContain(
          "'VIGENTE'",
        );

        expect(js).toContain(
          "'HISTORICO'",
        );
      },
    );

    test(
      'expediente conserva separacion maestro terreno',
      () => {
        expect(js).toContain(
          'summary.hallazgosProvisionales',
        );

        expect(js).toContain(
          "'Universo maestro'",
        );

        expect(js).toContain(
          "'Hallazgos adicionales'",
        );
      },
    );

    test(
      'expediente es compartible por url',
      () => {
        expect(js).toContain(
          "'dossier',",
        );

        expect(html).toContain(
          'data-explorer-panel="dossier"',
        );

        expect(routes).toContain(
          "router.get('/sessions/:id/audit-package'",
        );
      },
    );
  },
);
