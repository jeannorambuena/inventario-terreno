import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

const reportsHtml = readFileSync(new URL('../public/reports.html', import.meta.url), 'utf8');
const reportsSource = readFileSync(new URL('../public/reports.js', import.meta.url), 'utf8');

let database;
let app;
let evidenceRoot;
let importId;
let openLocationId;
let closedLocationId;
let untouchedLocationId;
let otherLocationId;
let openAssetIds;
let closedAssetIds;

function insertLocation(code, section) {
  return database.prepare(`
    INSERT INTO locations (location_code, name, direction, department, section)
    VALUES (?, ?, 'Dirección sintética', 'Departamento sintético', ?)
    RETURNING id
  `).get(code, `Ubicación ${code}`, section).id;
}

function insertAsset(code, locationId) {
  return database.prepare(`
    INSERT INTO assets (asset_code, inventory_import_id, location_id, name, scanner_code)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).get(code, importId, locationId, `Bien sintético ${code}`, `SCAN-${code}`).id;
}

beforeEach(() => {
  evidenceRoot = mkdtempSync(join(tmpdir(), 'inventario-reporting-synthetic-'));
  database = openDatabase(':memory:');
  importId = database.prepare(`
    INSERT INTO inventory_imports (
      import_code, source_name, source_checksum, sheet_name, row_count
    ) VALUES ('reporting-synthetic-import', 'synthetic.xlsx', 'synthetic-checksum', 'BD_SQL', 7)
    RETURNING id
  `).get().id;
  openLocationId = insertLocation('report-open', 'Sección en proceso');
  closedLocationId = insertLocation('report-closed', 'Sección finalizada');
  untouchedLocationId = insertLocation('report-untouched', 'Sección sin iniciar');
  otherLocationId = insertLocation('report-other', 'Sección de origen distinta');
  openAssetIds = [
    insertAsset('SYN-OPEN-001', openLocationId),
    insertAsset('SYN-OPEN-002', openLocationId),
    insertAsset('SYN-OPEN-003', openLocationId),
  ];
  closedAssetIds = [
    insertAsset('SYN-CLOSED-001', closedLocationId),
    insertAsset('SYN-CLOSED-002', closedLocationId),
  ];
  insertAsset('SYN-UNTOUCHED-001', untouchedLocationId);
  insertAsset('SYN-OTHER-001', otherLocationId);
  app = createApp({ database, evidenceRoot });
});

afterEach(() => {
  database.close();
  rmSync(evidenceRoot, { recursive: true, force: true });
});

async function createSession(locationId = openLocationId) {
  const response = await request(app).post('/api/sessions').send({ locationId }).expect(201);
  return response.body.session.id;
}

function structuredIncidence(sessionId, assetId, overrides = {}) {
  const identification = overrides.identification || ['etiqueta_deteriorada'];
  const physical = overrides.physical || ['regular'];
  const situation = overrides.situation || ['requiere_revision'];
  const label = identification.includes('sin_etiqueta') ? 'sin_etiqueta'
    : identification.includes('etiqueta_ilegible') ? 'ilegible'
      : identification.includes('etiqueta_deteriorada') ? 'deteriorada' : 'correcta';
  const details = {
    label,
    physicalCondition: physical.includes('incompleto') ? 'incompleto' : physical.includes('malo') ? 'malo' : physical.includes('regular') ? 'regular' : 'bueno',
    functionality: physical.includes('no_operativo') ? 'no_operativo' : 'operativo',
    proposedDisposal: physical.includes('propuesta_baja'),
    situations: situation,
    physicalPoint: { type: situation.includes('otra_ubicacion') || situation.includes('requiere_revision') || identification.includes('pendiente_identificar') ? 'sala' : '', reference: '' },
    discrepancies: identification.includes('datos_no_coinciden') ? [{ field: 'brand', masterValue: 'A', observedValue: 'B' }] : [],
    provisional: { pendingIdentification: identification.includes('pendiente_identificar') },
    incomplete: { parts: physical.includes('incompleto') ? ['cable'] : [] },
    review: { reason: situation.includes('requiere_revision') ? 'documentacion' : '' },
    custody: situation.some((value) => ['en_reparacion', 'prestamo_informado', 'traslado_no_regularizado'].includes(value))
      ? { destination: 'Unidad sintética', basis: 'informado' } : {},
  };
  const requestBuilder = request(app)
    .post(`/api/sessions/${sessionId}/incidences`)
    .field('assetId', String(assetId))
    .field('status', overrides.status || 'dato_distinto')
    .field('identification', JSON.stringify(identification))
    .field('physical', JSON.stringify(physical))
    .field('situation', JSON.stringify(situation))
    .field('details', JSON.stringify(details));
  if (overrides.photo) {
    requestBuilder
      .field('evidenceType', overrides.evidenceType || 'bien_completo')
      .attach('evidence', Buffer.from('synthetic-photo'), {
        filename: 'ignored-original.jpg',
        contentType: 'image/jpeg',
      });
  }
  return requestBuilder;
}

describe('operational reporting and secure evidence', () => {
  test('reports incidences with and without photographs and a provisional photographed finding', async () => {
    const sessionId = await createSession();
    const photographed = await structuredIncidence(sessionId, openAssetIds[0], { photo: true }).expect(201);
    await structuredIncidence(sessionId, openAssetIds[1], {
      physical: ['malo'],
      situation: ['en_reparacion'],
    }).expect(201);
    const provisional = await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('provisionalCode', 'SYN-PROVISIONAL-REPORT')
      .field('status', 'desconocido')
      .field('identification', JSON.stringify(['pendiente_identificar']))
      .field('physical', JSON.stringify(['no_operativo']))
      .field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({
        label: 'ilegible', functionality: 'no_operativo', situations: ['bien_no_registrado'],
        physicalPoint: { type: 'bodega', reference: '' },
        provisional: { description: 'Equipo sintético adicional', pendingIdentification: true },
      }))
      .field('evidenceType', 'etiqueta_patrimonial')
      .attach('evidence', Buffer.from('synthetic-provisional-photo'), {
        filename: 'private-name.png',
        contentType: 'image/png',
      })
      .expect(201);

    const report = await request(app).get(`/api/sessions/${sessionId}/report`).expect(200);
    expect(report.body.report.incidences).toHaveLength(3);
    expect(report.body.report.summary).toMatchObject({
      incidencias: 3,
      incidenciasConFoto: 2,
      hallazgosProvisionales: 1,
    });
    const provisionalDetail = report.body.report.incidences.find(({ provisionalCode }) => provisionalCode);
    expect(provisionalDetail).toMatchObject({
      assetId: null,
      assetCode: null,
      assetName: 'Equipo sintético adicional',
      recordKind: 'HALLAZGO PROVISIONAL',
      evidenceCount: 1,
    });

    const observationId = photographed.body.observation.id;
    const detail = await request(app)
      .get(`/api/sessions/${sessionId}/incidences/${observationId}`)
      .expect(200);
    expect(detail.body.incidence).toMatchObject({
      id: observationId,
      evidenceCount: 1,
      priority: 'alta',
    });
    expect(detail.body.incidence).not.toHaveProperty('notes');
    expect(JSON.stringify(detail.body.incidence)).not.toContain(evidenceRoot);

    const evidence = await request(app)
      .get(`/api/sessions/${sessionId}/incidences/${observationId}/evidence/0`)
      .expect('Content-Type', /image\/jpeg/)
      .expect(200);
    expect(evidence.headers['cache-control']).toBe('private, no-store');
    expect(evidence.headers['x-content-type-options']).toBe('nosniff');
    expect(provisional.body.evidence.path).not.toContain('private-name');
  });

  test('rejects traversal references and evidence access through another session', async () => {
    const sessionId = await createSession();
    const saved = await structuredIncidence(sessionId, openAssetIds[0], { photo: true }).expect(201);
    const observationId = saved.body.observation.id;
    const otherSessionId = await createSession(otherLocationId);

    await request(app)
      .get(`/api/sessions/${otherSessionId}/incidences/${observationId}/evidence/0`)
      .expect(404);

    database.prepare(`
      UPDATE observations SET notes = '[EVIDENCIA_TIPO:bien_completo] [EVIDENCIA_ARCHIVO:session-${sessionId}/../../escape.jpg]'
      WHERE id = ?
    `).run(observationId);
    await request(app)
      .get(`/api/sessions/${sessionId}/incidences/${observationId}/evidence/0`)
      .expect(400);
  });

  test.each([
    'problema_etiqueta',
    'sin_etiqueta',
    'datos_no_coinciden',
    'no_operativo',
    'malo',
    'propuesta_baja',
    'otra_ubicacion',
    'pendiente_identificar',
    'requiere_revision',
    'con_fotografia',
  ])('filters actionable incidences by %s', async (filter) => {
    const sessionId = await createSession();
    const overrides = { identification: ['etiqueta_deteriorada'], physical: ['regular'], situation: [] };
    if (filter === 'sin_etiqueta') overrides.identification = ['sin_etiqueta'];
    if (filter === 'datos_no_coinciden') overrides.identification = ['datos_no_coinciden'];
    if (filter === 'pendiente_identificar') overrides.identification = ['pendiente_identificar'];
    if (filter === 'no_operativo') overrides.physical = ['no_operativo'];
    if (filter === 'malo') overrides.physical = ['malo'];
    if (filter === 'propuesta_baja') overrides.physical = ['propuesta_baja'];
    if (filter === 'otra_ubicacion') { overrides.status = 'otra_ubicacion'; overrides.situation = ['otra_ubicacion']; }
    if (filter === 'requiere_revision') overrides.situation = ['requiere_revision'];
    if (filter === 'con_fotografia') overrides.photo = true;
    await structuredIncidence(sessionId, openAssetIds[0], overrides).expect(201);
    const filtered = await request(app)
      .get(`/api/sessions/${sessionId}/incidences?filter=${filter}`)
      .expect(200);
    expect(filtered.body.incidences).toHaveLength(1);
    expect(filtered.body.incidences[0].flags[filter]).toBe(true);
  });

  test('filters bien no registrado and combines filters with AND semantics', async () => {
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('provisionalCode', 'SYN-PROVISIONAL-FILTER')
      .field('status', 'desconocido')
      .field('identification', JSON.stringify(['sin_etiqueta']))
      .field('physical', '[]')
      .field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({
        label: 'sin_etiqueta', situations: ['bien_no_registrado'],
        physicalPoint: { type: 'bodega', reference: '' },
        provisional: { description: 'Objeto sintético sin etiqueta' },
      }))
      .expect(201);
    const filtered = await request(app)
      .get(`/api/sessions/${sessionId}/incidences?filter=bien_no_registrado,sin_etiqueta`)
      .expect(200);
    expect(filtered.body.incidences).toHaveLength(1);
  });

  test('derives progress and explicit section states without treating zero pending as closed', async () => {
    const openSessionId = await createSession();
    for (const assetId of openAssetIds) {
      await request(app).post(`/api/sessions/${openSessionId}/observations`)
        .send({ assetId, status: 'verificado', locationId: openLocationId })
        .expect(201);
    }
    const closedSessionId = await createSession(closedLocationId);
    await request(app).post(`/api/sessions/${closedSessionId}/observations`)
      .send({ assetId: closedAssetIds[0], status: 'verificado', locationId: closedLocationId })
      .expect(201);
    await request(app).post(`/api/sessions/${closedSessionId}/assets/${closedAssetIds[1]}/not-found`)
      .send({ confirm: true }).expect(201);
    await request(app).post(`/api/sessions/${closedSessionId}/close`).send({
      confirm: true, statement: 'field-review-complete', operatorCode: 'TEST', deviceCode: 'NOTEBOOK-TEST',
    }).expect(200);

    const response = await request(app).get('/api/reports/overview').expect(200);
    const sections = response.body.overview.directions
      .flatMap(({ departments }) => departments)
      .flatMap(({ sections: items }) => items);
    expect(sections.find(({ locationId }) => locationId === openLocationId)).toMatchObject({
      state: 'en_proceso',
      bienesEsperadosRevisados: 3,
      porcentajeRevision: 100,
      pendientes: 0,
    });
    expect(sections.find(({ locationId }) => locationId === closedLocationId)).toMatchObject({
      state: 'finalizada',
      bienesEsperadosRevisados: 2,
      porcentajeRevision: 100,
      pendientes: 0,
    });
    expect(sections.find(({ locationId }) => locationId === untouchedLocationId)).toMatchObject({
      state: 'sin_iniciar',
      bienesEsperadosRevisados: 0,
      porcentajeRevision: 0,
    });
    expect(response.body.overview.overall).toMatchObject({
      bienesEsperados: 7,
      bienesEsperadosRevisados: 5,
      porcentajeRevision: 71,
      enProceso: 1,
      finalizadas: 1,
      sinIniciar: 2,
    });
  });

  test('refuses to report a section as closed while expected assets remain pending', async () => {
    const sessionId = await createSession(closedLocationId);
    const rejected = await request(app).post(`/api/sessions/${sessionId}/close`).send({
      confirm: true, statement: 'field-review-complete', operatorCode: 'TEST', deviceCode: 'NOTEBOOK-TEST',
    }).expect(409);
    expect(rejected.body.readiness).toMatchObject({ ready: false, metrics: { pending: 2 } });
    const response = await request(app).get(`/api/sessions/${sessionId}/report`).expect(200);
    expect(response.body.report.summary).toMatchObject({ status: 'open', pendientes: 2 });
  });

  test('keeps historical structured notes compatible without altering their free-text remainder', async () => {
    const sessionId = await createSession();
    database.prepare(`
      INSERT INTO observations (
        observation_code, inventory_session_id, asset_id, status_code,
        selected_location_id, notes, observed_at
      ) VALUES ('historical-synthetic-observation', ?, ?, 'dato_distinto', ?,
        '[IDENTIFICACION:caracteristicas_no_coinciden] [SITUACION:pendiente_revision] Texto histórico sintético',
        '2025-01-01T00:00:00.000Z')
    `).run(sessionId, openAssetIds[0], openLocationId);
    const response = await request(app).get(`/api/sessions/${sessionId}/report`).expect(200);
    expect(response.body.report.incidences[0]).toMatchObject({
      priority: 'alta',
      flags: { datos_no_coinciden: true, requiere_revision: true },
    });
    expect(response.body.report.incidences[0]).not.toHaveProperty('notes');
  });

  test('provides executive, closure, incidence, regularization and print views without PDF dependencies', () => {
    for (const text of [
      'Resumen ejecutivo',
      'Informe de cierre de inventario en terreno',
      'Informe de incidencias',
      'Pendientes de regularización',
      'Imprimir / guardar PDF',
    ]) expect(reportsHtml).toContain(text);
    expect(reportsSource).toContain('window.print()');
    expect(reportsSource).toContain("api('/api/reports/overview')");
    expect(reportsSource).not.toMatch(/pdfkit|jspdf|innerHTML/);
  });
});
