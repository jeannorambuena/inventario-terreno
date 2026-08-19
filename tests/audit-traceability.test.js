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
        'trace-import',
        'trace.xlsx',
        'trace-checksum',
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
        'TRACE-LOC',
        'Dependencia trazabilidad',
        'Direccion trazabilidad',
        'Departamento trazabilidad',
        'Seccion trazabilidad'
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
        'TRACE-0001',
        ?,
        ?,
        'Bien trazable',
        'TRACE-SCAN-0001'
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


async function createTraceSession() {
  const created =
    await request(app)
      .post('/api/sessions')
      .send({
        locationId,
        operatorCode:
          'AUDITOR-TEST',
        deviceCode:
          'NOTEBOOK-TEST',
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
        'AUDITOR-TEST',
      deviceCode:
        'NOTEBOOK-TEST',
    })
    .expect(201);

  return sessionId;
}


describe(
  'trazabilidad y auditoria',
  () => {
    test(
      'expone auditoria de una sesion sin modificar datos',
      async () => {
        const sessionId =
          await createTraceSession();

        const before =
          database.prepare(
            'SELECT COUNT(*) AS count FROM audit_log',
          ).get().count;

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit`,
            )
            .expect(200);

        const after =
          database.prepare(
            'SELECT COUNT(*) AS count FROM audit_log',
          ).get().count;

        expect(after).toBe(before);

        expect(
          response.body.audit
            .map(
              ({ actionCode }) =>
                actionCode,
            ),
        ).toContain(
          'session_created',
        );

        expect(
          response.body.audit
            .map(
              ({ actionCode }) =>
                actionCode,
            ),
        ).toContain(
          'observation_created',
        );
      },
    );

    test(
      'vincula evento de observacion con bien maestro',
      async () => {
        const sessionId =
          await createTraceSession();

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/audit`,
            )
            .expect(200);

        const event =
          response.body.audit.find(
            ({ actionCode }) =>
              actionCode
              === 'observation_created',
          );

        expect(event).toMatchObject({
          assetId,
          assetCode: 'TRACE-0001',
          assetName: 'Bien trazable',
          displayCode: 'TRACE-0001',
          observationActive: true,
        });

        expect(
          event.payload.after.assetId,
        ).toBe(assetId);
      },
    );

    test(
      'busqueda global encuentra codigo patrimonial',
      async () => {
        await createTraceSession();

        const response =
          await request(app)
            .get(
              '/api/audit/search?q=TRACE-0001',
            )
            .expect(200);

        expect(
          response.body.matches,
        ).toHaveLength(1);

        expect(
          response.body.matches[0],
        ).toMatchObject({
          assetCode: 'TRACE-0001',
          displayCode: 'TRACE-0001',
          assetName: 'Bien trazable',
          locationId,
        });
      },
    );

    test(
      'busqueda global exige criterio suficiente',
      async () => {
        await request(app)
          .get('/api/audit/search?q=T')
          .expect(400);
      },
    );

    test(
      'dashboard incluye pestana de auditoria',
      () => {
        expect(html).toContain(
          'data-explorer-tab="audit"',
        );

        expect(html).toContain(
          'id="explorer-panel-audit"',
        );

        expect(html).toContain(
          'id="explorer-audit"',
        );
      },
    );

    test(
      'explorador carga audit log con el resto del estado',
      () => {
        expect(js).toContain(
          '`/api/sessions/${section.sessionId}/audit`',
        );

        expect(js).toContain(
          'state.explorerAuditEvents = audit;',
        );

        expect(js).toContain(
          'renderExplorerAudit(',
        );
      },
    );

    test(
      'distingue vigente e historico',
      () => {
        expect(js).toContain(
          "'VIGENTE'",
        );

        expect(js).toContain(
          "'HISTORICO'",
        );

        expect(css).toContain(
          '.audit-current-state',
        );

        expect(css).toContain(
          '.audit-historical-state',
        );
      },
    );

    test(
      'ficha de bien incluye historial',
      () => {
        expect(js).toContain(
          'function renderAssetAuditHistory(',
        );

        expect(js).toContain(
          "'Historial y trazabilidad'",
        );
      },
    );

    test(
      'permite buscar trazabilidad global',
      () => {
        expect(html).toContain(
          'id="traceability-search"',
        );

        expect(html).toContain(
          'id="trace-search-input"',
        );

        expect(js).toContain(
          'function searchGlobalTraceability()',
        );

        expect(routes).toContain(
          "router.get('/audit/search'",
        );
      },
    );

    test(
      'auditoria se conserva como pestana compartible',
      () => {
        expect(js).toContain(
          "'audit',",
        );

        expect(js).toContain(
          "setExplorerTab('audit');",
        );

        expect(css).toContain(
          '.audit-timeline',
        );
      },
    );
  },
);
