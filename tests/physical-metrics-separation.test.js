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


const reportsSource =
  readFileSync(
    new URL(
      '../public/reports.js',
      import.meta.url,
    ),
    'utf8',
  );

const routesSource =
  readFileSync(
    new URL(
      '../src/api/routes.js',
      import.meta.url,
    ),
    'utf8',
  );


let database;
let app;
let importId;
let activeLocationId;
let untouchedLocationId;


function insertLocation(
  code,
  section,
) {
  return database.prepare(`
    INSERT INTO locations (
      location_code,
      name,
      direction,
      department,
      section
    )
    VALUES (
      ?,
      ?,
      'Direccion metrica',
      'Departamento metrica',
      ?
    )
    RETURNING id
  `).get(
    code,
    `Ubicacion ${code}`,
    section,
  ).id;
}


function insertAsset(
  code,
  locationId,
) {
  return database.prepare(`
    INSERT INTO assets (
      asset_code,
      inventory_import_id,
      location_id,
      name,
      scanner_code
    )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?
    )
    RETURNING id
  `).get(
    code,
    importId,
    locationId,
    `Bien ${code}`,
    `SCAN-${code}`,
  ).id;
}


beforeEach(() => {
  database =
    openDatabase(':memory:');

  importId =
    database.prepare(`
      INSERT INTO inventory_imports (
        import_code,
        source_name,
        source_checksum,
        sheet_name,
        row_count
      )
      VALUES (
        'physical-metrics-import',
        'physical-metrics.xlsx',
        'physical-metrics-checksum',
        'BD_SQL',
        3
      )
      RETURNING id
    `).get().id;

  activeLocationId =
    insertLocation(
      'METRIC-ACTIVE',
      'Seccion activa',
    );

  untouchedLocationId =
    insertLocation(
      'METRIC-EMPTY',
      'Seccion sin iniciar',
    );

  insertAsset(
    'METRIC-001',
    activeLocationId,
  );

  insertAsset(
    'METRIC-002',
    activeLocationId,
  );

  insertAsset(
    'METRIC-003',
    untouchedLocationId,
  );

  app =
    createApp({
      database,
    });
});


afterEach(() => {
  database.close();
});


async function createSession() {
  const response =
    await request(app)
      .post('/api/sessions')
      .send({
        locationId:
          activeLocationId,

        operatorCode:
          'METRIC-TEST',

        deviceCode:
          'NOTEBOOK-METRIC',
      })
      .expect(201);

  return response.body.session.id;
}


function insertComplexPhysicalFinding(
  sessionId,
) {
  database.prepare(`
    INSERT INTO observations (
      observation_code,
      inventory_session_id,
      asset_id,
      provisional_code,
      status_code,
      selected_location_id,
      notes,
      observed_at,
      active,
      version_number
    )
    VALUES (
      'OBS-METRIC-0001',
      ?,
      NULL,
      'PROV-METRIC-0001',
      'desconocido',
      ?,
      ?,
      strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        'now'
      ),
      1,
      1
    )
  `).run(
    sessionId,
    activeLocationId,
    [
      '[IDENTIFICACION:sin_etiqueta]',
      '[IDENTIFICACION:pendiente_identificar]',
      '[ESTADO_FISICO:no_operativo]',
      '[SITUACION:bien_no_registrado]',
      '[SITUACION:requiere_revision]',
    ].join(' '),
  );
}


describe(
  'separacion de metricas fisicas',
  () => {
    test(
      'provisional does not increment expected reviewed assets',
      async () => {
        const sessionId =
          await createSession();

        insertComplexPhysicalFinding(
          sessionId,
        );

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/report`,
            )
            .expect(200);

        expect(
          response.body.report.summary,
        ).toMatchObject({
          bienesEsperados: 2,
          bienesEsperadosRevisados: 0,
          pendientes: 2,
          hallazgosProvisionales: 1,
        });
      },
    );


    test(
      'multiple incidence characteristics remain one physical finding',
      async () => {
        const sessionId =
          await createSession();

        insertComplexPhysicalFinding(
          sessionId,
        );

        const response =
          await request(app)
            .get(
              `/api/sessions/${sessionId}/report`,
            )
            .expect(200);

        expect(
          response.body.report.summary,
        ).toMatchObject({
          hallazgosProvisionales: 1,
          noRegistrados: 1,
          incidencias: 1,
          pendientesRevision: 1,
          noOperativos: 1,
        });
      },
    );


    test(
      'section overview keeps both physical and incidence dimensions',
      async () => {
        const sessionId =
          await createSession();

        insertComplexPhysicalFinding(
          sessionId,
        );

        const response =
          await request(app)
            .get('/api/reports/overview')
            .expect(200);

        const section =
          response.body.overview.directions
            .flatMap(
              ({ departments }) =>
                departments,
            )
            .flatMap(
              ({ sections }) =>
                sections,
            )
            .find(
              ({ locationId }) =>
                locationId
                === activeLocationId,
            );

        expect(section).toMatchObject({
          hallazgosProvisionales: 1,
          noRegistrados: 1,
          bienesEsperadosRevisados: 0,
        });
      },
    );


    test(
      'hierarchy aggregates physical findings once',
      async () => {
        const sessionId =
          await createSession();

        insertComplexPhysicalFinding(
          sessionId,
        );

        const response =
          await request(app)
            .get('/api/reports/overview')
            .expect(200);

        const overview =
          response.body.overview;

        const direction =
          overview.directions[0];

        const department =
          direction.departments[0];

        expect(
          department.metrics
            .hallazgosProvisionales,
        ).toBe(1);

        expect(
          direction.metrics
            .hallazgosProvisionales,
        ).toBe(1);

        expect(
          overview.overall
            .hallazgosProvisionales,
        ).toBe(1);
      },
    );


    test(
      'untouched section exposes zero physical findings',
      async () => {
        const response =
          await request(app)
            .get('/api/reports/overview')
            .expect(200);

        const section =
          response.body.overview.directions
            .flatMap(
              ({ departments }) =>
                departments,
            )
            .flatMap(
              ({ sections }) =>
                sections,
            )
            .find(
              ({ locationId }) =>
                locationId
                === untouchedLocationId,
            );

        expect(
          section.hallazgosProvisionales,
        ).toBe(0);
      },
    );


    test(
      'backend explicitly propagates physical finding metric',
      () => {
        expect(routesSource).toContain(
          'hallazgosProvisionales: 0',
        );

        expect(routesSource).toContain(
          "'hallazgosProvisionales'",
        );

        expect(routesSource).toContain(
          'AS hallazgosProvisionales',
        );

        expect(routesSource).toContain(
          'AS noRegistrados',
        );
      },
    );


    test(
      'physical-facing dashboard uses provisional finding count',
      () => {
        expect(reportsSource).toContain(
          'metrics.hallazgosProvisionales',
        );

        expect(reportsSource).toContain(
          'overall.hallazgosProvisionales',
        );

        expect(reportsSource).toContain(
          'section.hallazgosProvisionales',
        );

        expect(reportsSource).toContain(
          'summary.hallazgosProvisionales',
        );
      },
    );


    test(
      'noRegistrados remains an independent incidence dimension',
      () => {
        expect(reportsSource).toContain(
          "'No registrados', "
          + "number(metrics.noRegistrados), "
          + "'danger'",
        );

        expect(reportsSource).toContain(
          "'No registrados', "
          + "number(summary.noRegistrados), "
          + "'danger'",
        );

        expect(reportsSource).toContain(
          'number(section.noRegistrados)',
        );

        expect(routesSource).toContain(
          'AS noRegistrados',
        );
      },
    );
  },
);
