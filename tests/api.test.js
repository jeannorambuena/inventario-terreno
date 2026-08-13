import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

let database;
let app;
let locationId;
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
  locationId = location.id;
  assetId = asset.id;
  app = createApp({ database });
});

afterEach(() => database.close());

describe('inventory API', () => {
  test('lists locations and finds assets by location, search and exact code', async () => {
    const locations = await request(app).get('/api/locations').expect(200);
    expect(locations.body.locations).toHaveLength(1);

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
      observed: 1,
      pending: 0,
      progressPercent: 100,
      statusCounts: { verificado: 1 },
    });

    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).expect(200);
    expect(closed.body.summary.status).toBe('closed');
  });

  test('accepts a provisional synthetic code for an unknown asset', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .send({ locationId })
      .expect(201);

    const response = await request(app)
      .post(`/api/sessions/${created.body.session.id}/observations`)
      .send({
        provisionalCode: 'SINTETICO-0001',
        status: 'desconocido',
        locationId,
        observation: '',
      })
      .expect(201);

    expect(response.body.observation).toMatchObject({
      provisionalCode: 'SINTETICO-0001',
      status: 'desconocido',
    });
  });
});
