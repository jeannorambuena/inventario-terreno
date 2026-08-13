import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

let database;
let app;
let locationId;
let otherLocationId;
let assetId;

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
    ) VALUES ('0010600073', ?, ?, 'Bien sintético', '0000000123')
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

    const search = await request(app).get('/api/assets/search?q=001060').expect(200);
    expect(search.body.assets).toHaveLength(1);

    const byCode = await request(app).get('/api/assets/by-code/0000000123').expect(200);
    expect(byCode.body.asset.id).toBe(assetId);
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

    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).expect(200);
    expect(closed.body.summary.status).toBe('closed');
  });

  test('requires an unknown status and notes for a provisional synthetic code', async () => {
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

    const response = await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        provisionalCode: 'SINTETICO-0001',
        status: 'desconocido',
        locationId,
        observation: 'Hallazgo provisional completamente sintético',
      })
      .expect(201);

    expect(response.body.observation).toMatchObject({
      sessionId: created.body.session.id,
      provisionalCode: 'SINTETICO-0001',
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

  test('keeps the exact 12-item closing summary consistent before and after close', async () => {
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

    const afterClose = await request(app)
      .post(`/api/sessions/${sessionId}/close`)
      .expect(200);
    expect(afterClose.body.summary).toMatchObject({ status: 'closed', ...expectedMetrics });

    const persistedLinks = database.prepare(`
      SELECT COUNT(*) AS count
      FROM observations
      WHERE inventory_session_id = ?
    `).get(sessionId);
    expect(persistedLinks.count).toBe(2);
  });

  test('returns numeric zeroes after closing a 12-item session without observations', async () => {
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
      .expect(200);

    expect(closed.body.summary).toMatchObject({
      status: 'closed',
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
});
