import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

const syntheticNetwork = () => [{ interface: 'Synthetic LAN', address: '192.168.50.10' }];
const authorization = (token) => ({ Authorization: `Bearer ${token}` });

let database;
let app;
let locationId;
let otherLocationId;
let localAssetId;

beforeEach(() => {
  database = openDatabase(':memory:');
  const inventoryImportId = database.prepare(`
    INSERT INTO inventory_imports (
      import_code, source_name, source_checksum, sheet_name, row_count
    ) VALUES ('mobile-synthetic-import', 'synthetic.xlsx', 'synthetic-checksum', 'BD_SQL', 3)
    RETURNING id
  `).get().id;
  locationId = database.prepare(`
    INSERT INTO locations (location_code, name, direction, department, section)
    VALUES ('mobile-location', 'Ubicación móvil sintética',
      'Dirección sintética', 'Departamento sintético', 'Sección sintética')
    RETURNING id
  `).get().id;
  otherLocationId = database.prepare(`
    INSERT INTO locations (location_code, name, direction, department, section)
    VALUES ('mobile-other-location', 'Otra ubicación sintética',
      'Otra dirección sintética', 'Otro departamento sintético', 'Otra sección sintética')
    RETURNING id
  `).get().id;
  const insertAsset = database.prepare(`
    INSERT INTO assets (asset_code, inventory_import_id, location_id, name, scanner_code)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `);
  localAssetId = insertAsset.get(
    '0010000001', inventoryImportId, locationId, 'Bien móvil sintético A', '0020000001',
  ).id;
  insertAsset.run(
    '0010000002', inventoryImportId, locationId, 'Bien móvil sintético B', '0020000002',
  );
  insertAsset.run(
    '0030000001', inventoryImportId, otherLocationId, 'Bien sintético de otra ubicación', '0040000001',
  );
  app = createApp({ database, networkInfoProvider: syntheticNetwork });
});

afterEach(() => database.close());

async function createSession() {
  const response = await request(app).post('/api/sessions').send({ locationId }).expect(201);
  return response.body.session.id;
}

async function pair(sessionId) {
  const response = await request(app).post(`/api/sessions/${sessionId}/pair`).expect(201);
  return response.body.pairing;
}

describe('mobile integration API', () => {
  test('reports private network information', async () => {
    const response = await request(app).get('/api/network-info').expect(200);
    expect(response.body).toEqual({
      port: 3180,
      addresses: syntheticNetwork(),
      mobileUrls: ['http://192.168.50.10:3180/mobile'],
    });
  });

  test('pairs a valid open session with a local mobile URL and QR', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    expect(pairing).toMatchObject({ sessionId });
    expect(pairing.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pairing.mobileUrl).toContain('http://192.168.50.10:3180/mobile?');
    expect(pairing.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const mobile = await request(app)
      .get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(pairing.token))
      .expect(200);
    expect(mobile.body.session.id).toBe(sessionId);
  });

  test('rejects an invalid token', async () => {
    const sessionId = await createSession();
    await request(app)
      .get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization('invalid-synthetic-token'))
      .expect(401);
  });

  test('rejects an expired token', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    database.prepare(`
      UPDATE session_pairings SET expires_at = '2000-01-01T00:00:00.000Z'
      WHERE inventory_session_id = ?
    `).run(sessionId);
    await request(app)
      .get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(pairing.token))
      .expect(401);
  });

  test('records a valid mobile observation with the same session id', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const response = await request(app)
      .post(`/api/sessions/${sessionId}/mobile-observations`)
      .set(authorization(pairing.token))
      .send({ code: '0010000001', status: 'verificado', observation: '' })
      .expect(201);
    expect(response.body.observation).toMatchObject({ sessionId, assetId: localAssetId });
  });

  test('rejects a duplicate mobile observation', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const path = `/api/sessions/${sessionId}/mobile-observations`;
    const body = { code: '0010000001', status: 'verificado', observation: '' };
    await request(app).post(path).set(authorization(pairing.token)).send(body).expect(201);
    await request(app).post(path).set(authorization(pairing.token)).send(body).expect(409);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id = ?
    `).get(sessionId).count).toBe(1);
  });

  test.each([
    ['dato_distinto', '0010000001'],
    ['no_ubicado', '0010000001'],
    ['otra_ubicacion', '0030000001'],
    ['desconocido', 'SINTETICO-SIN-NOTA'],
  ])('rejects blank notes for mobile status %s', async (status, code) => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    await request(app)
      .post(`/api/sessions/${sessionId}/mobile-observations`)
      .set(authorization(pairing.token))
      .send({ code, status, observation: '   ' })
      .expect(400);
  });

  test('blocks mobile session closing while expected assets remain pending', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    await request(app)
      .post(`/api/sessions/${sessionId}/mobile-observations`)
      .set(authorization(pairing.token))
      .send({ code: '0010000001', status: 'verificado', observation: '' })
      .expect(201);
    const blocked = await request(app).post(`/api/sessions/${sessionId}/close`).expect(409);
    expect(blocked.body.summary).toMatchObject({ pendientes: 1, status: 'open' });
  });

  test('requires selecting an asset when a scanner code has multiple matches', async () => {
    const importId = database.prepare(`
      SELECT id FROM inventory_imports WHERE import_code = 'mobile-synthetic-import'
    `).get().id;
    const duplicateAssetId = database.prepare(`
      INSERT INTO assets (asset_code, inventory_import_id, location_id, name, scanner_code)
      VALUES ('0090000001', ?, ?, 'Duplicado sintético', '0020000001')
      RETURNING id
    `).get(importId, otherLocationId).id;
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const path = `/api/sessions/${sessionId}/mobile-observations`;
    const ambiguous = await request(app).post(path).set(authorization(pairing.token))
      .send({ code: '0020000001', status: 'otra_ubicacion', observation: 'Sintética' })
      .expect(409);
    expect(ambiguous.body.matches).toHaveLength(2);
    await request(app).post(path).set(authorization(pairing.token))
      .send({
        code: '0020000001',
        assetId: duplicateAssetId,
        status: 'otra_ubicacion',
        observation: 'Selección sintética',
      })
      .expect(201);
  });

  test('revokes the token when closing the session', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const path = `/api/sessions/${sessionId}/mobile-observations`;
    await request(app).post(path).set(authorization(pairing.token))
      .send({ code: '0010000001', status: 'verificado', observation: '' }).expect(201);
    await request(app).post(path).set(authorization(pairing.token))
      .send({ code: '0010000002', status: 'no_ubicado', observation: 'Sintética' }).expect(201);
    await request(app).post(`/api/sessions/${sessionId}/close`).expect(200);
    await request(app)
      .get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(pairing.token))
      .expect(401);
  });

  test('returns a numeric zero summary for a new session', async () => {
    const sessionId = await createSession();
    const summary = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    expect(summary.body.summary).toMatchObject({
      observations: 0,
      verifiedExpected: 0,
      locationDifferences: 0,
      provisionalFindings: 0,
      pending: 2,
      progressPercent: 0,
    });
  });

  test('summarizes verified, other-location and provisional mobile observations consistently', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const path = `/api/sessions/${sessionId}/mobile-observations`;
    const mobile = () => request(app).post(path).set(authorization(pairing.token));
    await mobile().send({ code: '0010000001', status: 'verificado', observation: '' }).expect(201);
    await mobile().send({
      code: '0030000001', status: 'otra_ubicacion', observation: 'Diferencia sintética',
    }).expect(201);
    await mobile().send({
      code: 'SINTETICO-MOVIL-01', status: 'desconocido', observation: 'Hallazgo sintético',
    }).expect(201);
    await mobile().send({
      code: '0010000002', status: 'no_ubicado', observation: 'No ubicado sintético',
    }).expect(201);

    const expected = {
      observations: 4,
      verifiedExpected: 1,
      locationDifferences: 1,
      provisionalFindings: 1,
      bienesEsperadosRevisados: 2,
      noUbicados: 1,
      pending: 0,
      progressPercent: 100,
    };
    const before = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    expect(before.body.summary).toMatchObject(expected);
    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).expect(200);
    expect(closed.body.summary).toMatchObject(expected);
  });
});
