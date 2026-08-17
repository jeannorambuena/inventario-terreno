import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

let database;
let app;
let locationId;
let otherLocationId;
let assetId;
const closePayload = {
  confirm: true,
  statement: 'field-review-complete',
  operatorCode: 'OPERADOR-TEST',
  deviceCode: 'NOTEBOOK-TEST',
};

beforeEach(() => {
  database = openDatabase(':memory:');
  const inventoryImport = database.prepare(`
    INSERT INTO inventory_imports (
      import_code, source_name, source_checksum, sheet_name, row_count
    ) VALUES ('synthetic-import', 'synthetic.xlsx', 'synthetic-checksum', 'BD_SQL', 1)
    RETURNING id
  `).get();
  const location = database.prepare(`
    INSERT INTO locations (
      location_code, name, direction, department, section
    ) VALUES ('synthetic-location', 'Ubicación sintética',
      'Dirección sintética', 'Departamento sintético', 'Sección sintética')
    RETURNING id
  `).get();
  const asset = database.prepare(`
    INSERT INTO assets (
      asset_code, inventory_import_id, location_id, name, scanner_code
    ) VALUES ('SYN-BIEN-0001', ?, ?, 'Bien sintético', 'SYN-SCAN-0001')
    RETURNING id
  `).get(inventoryImport.id, location.id);
  const otherLocation = database.prepare(`
    INSERT INTO locations (
      location_code, name, direction, department, section
    ) VALUES ('synthetic-location-other', 'Otra ubicación sintética',
      'Otra dirección sintética', 'Otro departamento sintético', 'Otra sección sintética')
    RETURNING id
  `).get();
  locationId = location.id;
  otherLocationId = otherLocation.id;
  assetId = asset.id;
  app = createApp({ database });
});

afterEach(() => database.close());

describe('inventory API', () => {
  test('lists locations and finds assets by location, search and exact code', async () => {
    const locations = await request(app).get('/api/locations').expect(200);
    expect(locations.body.locations).toHaveLength(2);

    const assets = await request(app).get(`/api/assets?locationId=${locationId}`).expect(200);
    expect(assets.body.assets).toHaveLength(1);

    const search = await request(app).get('/api/assets/search?q=SYN-SCAN').expect(200);
    expect(search.body.assets).toHaveLength(1);

    const byCode = await request(app).get('/api/assets/by-code/SYN-SCAN-0001').expect(200);
    expect(byCode.body.asset.id).toBe(assetId);
  });

  test('resumes the single open session instead of creating a duplicate', async () => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    const resumed = await request(app).post('/api/sessions').send({ locationId }).expect(200);

    expect(resumed.body).toMatchObject({ resumed: true, session: { id: created.body.session.id } });
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM inventory_sessions
      WHERE location_id = ? AND status_code = 'open'
    `).get(locationId).count).toBe(1);
  });

  test('two concurrent starts produce one open session', async () => {
    const responses = await Promise.all([
      request(app).post('/api/sessions').send({ locationId }),
      request(app).post('/api/sessions').send({ locationId }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(new Set(responses.map(({ body }) => body.session.id)).size).toBe(1);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM inventory_sessions
      WHERE location_id = ? AND status_code = 'open'
    `).get(locationId).count).toBe(1);
  });

  test('database trigger rejects a direct duplicate open session', async () => {
    await request(app).post('/api/sessions').send({ locationId }).expect(201);
    expect(() => database.prepare(`
      INSERT INTO inventory_sessions (session_code, location_id, status_code)
      VALUES ('direct-synthetic-duplicate', ?, 'open')
    `).run(locationId)).toThrow(/open session already exists/);
  });

  test('reports a historical multiple-open-session conflict without choosing one', async () => {
    const first = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    database.exec(`
      DROP TRIGGER prevent_duplicate_open_session_insert;
      DROP TRIGGER prevent_duplicate_open_session_update;
    `);
    database.prepare(`
      INSERT INTO inventory_sessions (session_code, location_id, status_code)
      VALUES ('historical-synthetic-conflict', ?, 'open')
    `).run(locationId);

    const conflict = await request(app).post('/api/sessions').send({ locationId }).expect(409);
    expect(conflict.body.sessions).toHaveLength(2);
    expect(conflict.body.sessions.map(({ id }) => id)).toContain(first.body.session.id);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM inventory_sessions
      WHERE location_id = ? AND status_code = 'open'
    `).get(locationId).count).toBe(2);
  });

  test('creates a session, records an observation, summarizes and closes it', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .send({ locationId })
      .expect(201);
    const sessionId = created.body.session.id;

    await request(app)
      .post(`/api/sessions/${sessionId}/observations`)
      .send({
        assetId,
        status: 'verificado',
        locationId,
        observation: 'Observación completamente sintética',
        observedAt: '2026-01-01T12:00:00.000Z',
      })
      .expect(201);

    const summary = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    expect(summary.body.summary).toMatchObject({
      totalAssets: 1,
      observations: 1,
      observationCount: 1,
      verifiedExpected: 1,
      locationDifferences: 0,
      provisionalFindings: 0,
      observed: 1,
      pending: 0,
      progressPercent: 100,
      statusCounts: { verificado: 1 },
    });

    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(200);
    expect(closed.body.summary.status).toBe('closed');
  });

  test('undoes only the displayed last observation and records an audit snapshot', async () => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    const sessionId = created.body.session.id;
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId,
      status: 'verificado',
      locationId,
      observation: '',
    }).expect(201);

    const before = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    expect(before.body.summary.lastObservation).toMatchObject({
      code: 'SYN-BIEN-0001',
      name: 'Bien sintético',
      status: 'verificado',
    });

    const undone = await request(app)
      .post(`/api/sessions/${sessionId}/observations/undo-last`)
      .send({
        observationCode: before.body.summary.lastObservation.observationCode,
        reason: 'Registro sintético accidental',
        confirm: true,
      })
      .expect(200);

    expect(undone.body.summary).toMatchObject({
      status: 'open',
      bienesEsperados: 1,
      bienesEsperadosRevisados: 0,
      bienesConformes: 0,
      pendientes: 1,
      porcentajeRevision: 0,
      lastObservation: null,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id = ? AND active = 1')
      .get(sessionId).count).toBe(0);
    const audit = database.prepare(`
      SELECT entity_type AS entityType, entity_code AS entityCode,
        action_code AS actionCode, details_json AS detailsJson
      FROM audit_log WHERE action_code = 'undo_last_observation'
    `).get();
    expect(audit).toMatchObject({
      entityType: 'observation',
      entityCode: before.body.summary.lastObservation.observationCode,
      actionCode: 'undo_last_observation',
    });
    expect(JSON.parse(audit.detailsJson)).toMatchObject({
      details: { reason: 'Registro sintético accidental' },
      before: { sessionId, assetId, status: 'verificado' },
    });
  });

  test('rejects a stale undo when another device registered a newer observation', async () => {
    const importId = database.prepare("SELECT id FROM inventory_imports WHERE import_code = 'synthetic-import'").get().id;
    const secondAssetId = database.prepare(`
      INSERT INTO assets (asset_code, inventory_import_id, location_id, name, scanner_code)
      VALUES ('SYN-BIEN-0002', ?, ?, 'Segundo bien sintético', 'SYN-SCAN-0002')
      RETURNING id
    `).get(importId, locationId).id;
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    const sessionId = created.body.session.id;
    const observation = (id) => request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: id, status: 'verificado', locationId, observation: '',
    });
    await observation(assetId).expect(201);
    const displayed = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    const pairing = await request(app).post(`/api/sessions/${sessionId}/pair`).expect(201);
    await request(app)
      .post(`/api/sessions/${sessionId}/mobile-observations`)
      .set({ Authorization: `Bearer ${pairing.body.pairing.token}` })
      .send({ code: 'SYN-BIEN-0002', assetId: secondAssetId, status: 'verificado', observation: '' })
      .expect(201);

    const conflict = await request(app)
      .post(`/api/sessions/${sessionId}/observations/undo-last`)
      .send({
        observationCode: displayed.body.summary.lastObservation.observationCode,
        reason: 'Intento sintético sobre vista desactualizada',
        confirm: true,
      })
      .expect(409);

    expect(conflict.body.error).toMatch(/cambió en otro dispositivo/i);
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id = ?')
      .get(sessionId).count).toBe(2);
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action_code = 'undo_last_observation'").get().count).toBe(0);
  });

  test.each(['closed', 'cancelled'])('does not undo an observation in a %s session', async (status) => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    const sessionId = created.body.session.id;
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId, status: 'verificado', locationId, observation: '',
    }).expect(201);
    const summary = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    if (status === 'closed') await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(200);
    else {
      await request(app).post(`/api/sessions/${sessionId}/cancel`)
        .send({ reason: 'Cancelación sintética', confirm: true }).expect(200);
    }

    await request(app).post(`/api/sessions/${sessionId}/observations/undo-last`).send({
      observationCode: summary.body.summary.lastObservation.observationCode,
      reason: 'No debe ejecutarse',
      confirm: true,
    }).expect(409);
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id = ?')
      .get(sessionId).count).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action_code = 'undo_last_observation'").get().count).toBe(0);
  });

  test('rejects client provisional identifiers and generates them through the structured flow', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .send({ locationId })
      .expect(201);

    await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        provisionalCode: 'SINTETICO-0001',
        status: 'verificado',
        locationId,
        observation: '',
      })
      .expect(400);

    await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        provisionalCode: 'SINTETICO-0001',
        status: 'desconocido',
        locationId,
        observation: '',
      })
      .expect(400);

    await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        provisionalCode: 'SINTETICO-0001',
        status: 'desconocido',
        locationId,
        observation: 'Hallazgo provisional completamente sintético',
      })
      .expect(400);

    const response = await request(app)
      .post(`/api/sessions/${created.body.session.id}/incidences`)
      .field('status', 'desconocido')
      .field('identification', JSON.stringify(['sin_etiqueta']))
      .field('physical', '[]')
      .field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({
        label: 'sin_etiqueta', situations: ['bien_no_registrado'],
        physicalPoint: { type: 'sala' },
        provisional: { description: 'Hallazgo provisional completamente sintético', observedCode: 'SINTETICO-0001' },
      }))
      .expect(201);

    expect(response.body.observation).toMatchObject({
      sessionId: created.body.session.id,
      provisionalCode: `PROV-S${created.body.session.id}-0001`,
      status: 'desconocido',
    });
    expect(response.body.observation.assetId).toBeNull();

    const summary = await request(app)
      .get(`/api/sessions/${created.body.session.id}/summary`)
      .expect(200);
    expect(summary.body.summary).toMatchObject({
      observations: 1,
      observationCount: 1,
      verifiedExpected: 0,
      provisionalFindings: 1,
      observed: 0,
      pending: 1,
      progressPercent: 0,
    });
  });

  test('rejects verified when the asset belongs to another location', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .send({ locationId: otherLocationId })
      .expect(201);

    const rejected = await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        assetId,
        status: 'verificado',
        locationId: otherLocationId,
        observation: '',
      })
      .expect(409);
    expect(rejected.body.error).toContain('otra ubicación');

    await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        assetId,
        status: 'otra_ubicacion',
        locationId: otherLocationId,
        observation: 'Caso completamente sintético',
      })
      .expect(201);
  });

  test('refuses to close the exact 12-item session while 11 assets remain pending', async () => {
    const inventoryImportId = database
      .prepare("SELECT id FROM inventory_imports WHERE import_code = 'synthetic-import'")
      .get().id;
    const insertAsset = database.prepare(`
      INSERT INTO assets (
        asset_code, inventory_import_id, location_id, name, scanner_code
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (let index = 2; index <= 12; index += 1) {
      const suffix = String(index).padStart(9, '0');
      insertAsset.run(
        `1${suffix}`,
        inventoryImportId,
        locationId,
        `Bien sintético ${index}`,
        `2${suffix}`,
      );
    }
    const otherAsset = database.prepare(`
      INSERT INTO assets (
        asset_code, inventory_import_id, location_id, name, scanner_code
      ) VALUES ('3000000001', ?, ?, 'Bien de otra ubicación sintética', '4000000001')
      RETURNING id
    `).get(inventoryImportId, otherLocationId);

    const created = await request(app)
      .post('/api/sessions')
      .send({ locationId })
      .expect(201);
    const sessionId = created.body.session.id;

    const verified = await request(app)
      .post(`/api/sessions/${sessionId}/observations`)
      .send({
        assetId,
        status: 'verificado',
        locationId,
        observation: '',
      })
      .expect(201);
    expect(verified.body.observation.sessionId).toBe(sessionId);

    const differentLocation = await request(app)
      .post(`/api/sessions/${sessionId}/observations`)
      .send({
        assetId: otherAsset.id,
        status: 'otra_ubicacion',
        locationId,
        observation: 'Diferencia completamente sintética',
      })
      .expect(201);
    expect(differentLocation.body.observation.sessionId).toBe(sessionId);

    const expectedMetrics = {
      totalAssets: 12,
      observations: 2,
      observationCount: 2,
      verifiedExpected: 1,
      locationDifferences: 1,
      provisionalFindings: 0,
      observed: 1,
      pending: 11,
      progressPercent: 8,
    };
    const beforeClose = await request(app)
      .get(`/api/sessions/${sessionId}/summary`)
      .expect(200);
    expect(beforeClose.body.summary).toMatchObject({ status: 'open', ...expectedMetrics });

    const closed = await request(app)
      .post(`/api/sessions/${sessionId}/close`)
      .send(closePayload)
      .expect(409);
    expect(closed.body.summary).toMatchObject({ status: 'open', ...expectedMetrics });
    expect(closed.body.readiness).toMatchObject({ ready: false, metrics: { pending: 11 } });

    const persistedLinks = database.prepare(`
      SELECT COUNT(*) AS count
      FROM observations
      WHERE inventory_session_id = ?
    `).get(sessionId);
    expect(persistedLinks.count).toBe(2);
  });

  test('returns numeric zeroes and refuses to close a 12-item session with all assets pending', async () => {
    const inventoryImportId = database
      .prepare("SELECT id FROM inventory_imports WHERE import_code = 'synthetic-import'")
      .get().id;
    const insertAsset = database.prepare(`
      INSERT INTO assets (
        asset_code, inventory_import_id, location_id, name, scanner_code
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (let index = 2; index <= 12; index += 1) {
      const suffix = String(index).padStart(9, '0');
      insertAsset.run(
        `5${suffix}`,
        inventoryImportId,
        locationId,
        `Bien sintético sin observación ${index}`,
        `6${suffix}`,
      );
    }

    const created = await request(app)
      .post('/api/sessions')
      .send({ locationId })
      .expect(201);
    const closed = await request(app)
      .post(`/api/sessions/${created.body.session.id}/close`)
      .send(closePayload)
      .expect(409);

    expect(closed.body.summary).toMatchObject({
      status: 'open',
      totalAssets: 12,
      observations: 0,
      verifiedExpected: 0,
      locationDifferences: 0,
      provisionalFindings: 0,
      pending: 12,
      progressPercent: 0,
    });
    for (const field of [
      'observations',
      'verifiedExpected',
      'locationDifferences',
      'provisionalFindings',
      'pending',
      'progressPercent',
    ]) {
      expect(typeof closed.body.summary[field]).toBe('number');
    }
  });

  test.each([
    ['dato_distinto'],
    ['no_ubicado'],
    ['otra_ubicacion'],
    ['desconocido'],
  ])('rejects empty and whitespace notes for %s', async (status) => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    const base = status === 'desconocido'
      ? { provisionalCode: `SINTETICO-${status}`, status, locationId }
      : { assetId, status, locationId };
    await request(app).post(`/api/sessions/${created.body.session.id}/observations`)
      .send({ ...base, observation: '' }).expect(400);
    await request(app).post(`/api/sessions/${created.body.session.id}/observations`)
      .send({ ...base, observation: '   ' }).expect(400);
  });

  test('accepts verified without notes', async () => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    await request(app).post(`/api/sessions/${created.body.session.id}/observations`)
      .send({ assetId, status: 'verificado', locationId, observation: '' }).expect(201);
  });

  test.each([
    ['dato_distinto', 'datosDistintos'],
    ['no_ubicado', 'noUbicados'],
  ])('%s reviews an expected asset and reduces pending', async (status, metric) => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    await request(app).post(`/api/sessions/${created.body.session.id}/observations`)
      .send({ assetId, status, locationId, observation: 'Dato sintético obligatorio' }).expect(201);
    const summary = await request(app).get(`/api/sessions/${created.body.session.id}/summary`).expect(200);
    expect(summary.body.summary).toMatchObject({
      bienesEsperadosRevisados: 1,
      [metric]: 1,
      pendientes: 0,
      porcentajeRevision: 100,
    });
  });

  test('returns all matches for a duplicated scanner code', async () => {
    const importId = database.prepare("SELECT id FROM inventory_imports WHERE import_code = 'synthetic-import'").get().id;
    database.prepare(`
      INSERT INTO assets (asset_code, inventory_import_id, location_id, name, scanner_code)
      VALUES ('SYN-BIEN-0002', ?, ?, 'Coincidencia sintética', 'SYN-SCAN-0001')
    `).run(importId, otherLocationId);
    const response = await request(app).get('/api/assets/by-code/SYN-SCAN-0001').expect(200);
    expect(response.body).toMatchObject({ asset: null, ambiguous: true });
    expect(response.body.matches).toHaveLength(2);
  });

  test('pending assets exclude assets already reviewed', async () => {
    const created = await request(app).post('/api/sessions').send({ locationId }).expect(201);
    await request(app).post(`/api/sessions/${created.body.session.id}/observations`)
      .send({ assetId, status: 'dato_distinto', locationId, observation: 'Sintética' }).expect(201);
    const pending = await request(app).get(`/api/sessions/${created.body.session.id}/pending-assets`).expect(200);
    expect(pending.body.assets.map(({ id }) => id)).not.toContain(assetId);
  });
});
