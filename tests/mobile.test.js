import { readFileSync } from 'node:fs';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';
import {
  createMobileDeviceSuffix,
  createPollingFailureTracker,
  createSafeNetworkError,
  temporaryConnectionMessage,
} from '../public/mobile-polling.js';
import { createLookupCodeVariants } from '../public/code-normalization.js';
import { serializeIncidence } from '../public/incidence.js';

const syntheticNetwork = () => [{ interface: 'Synthetic LAN', address: '192.168.50.10' }];
const authorization = (token) => ({ Authorization: `Bearer ${token}` });
const mobileSource = readFileSync(new URL('../public/mobile.js', import.meta.url), 'utf8');
const mobileHtml = readFileSync(new URL('../public/mobile.html', import.meta.url), 'utf8');
const notebookSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

let database;
let app;
let locationId;
let otherLocationId;
let localAssetId;
let otherAssetId;
const closePayload = {
  confirm: true,
  statement: 'field-review-complete',
  operatorCode: 'OPERADOR-MOVIL-TEST',
  deviceCode: 'NOTEBOOK-TEST',
};

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
  otherAssetId = insertAsset.run(
    '0030000001', inventoryImportId, otherLocationId, 'Bien sintético de otra ubicación', '0040000001',
  ).lastInsertRowid;
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

describe('mobile HTTP runtime compatibility', () => {
  test('creates device suffix in HTTP runtime without randomUUID', () => {
    const cryptoWithoutRandomUuid = {
      getRandomValues(buffer) {
        buffer.set([0x12, 0x34, 0xab, 0xcd]);
        return buffer;
      },
    };

    expect(createMobileDeviceSuffix(cryptoWithoutRandomUuid))
      .toBe('1234abcd');
  });

  test('mobile client does not depend directly on crypto.randomUUID', () => {
    expect(mobileSource).not.toContain('crypto.randomUUID()');
    expect(mobileSource).toContain('createMobileDeviceSuffix()');
  });
});

describe('mobile integration API', () => {
  test('preserves leading zeros and accepts municipal codes with or without hyphens', async () => {
    expect(createLookupCodeVariants('01-08-00047')).toEqual([
      '01-08-00047', '010800047', '0010800047',
    ]);
    expect(createLookupCodeVariants('0010800047')).toEqual([
      '0010800047', '010800047', '01-08-00047',
    ]);
    expect(createLookupCodeVariants('01-11-00395')).toEqual([
      '01-11-00395', '011100395', '0011100395',
    ]);
    expect(createLookupCodeVariants('0011100395')).toEqual([
      '0011100395', '011100395', '01-11-00395',
    ]);

    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const response = await request(app)
      .get(`/api/sessions/${sessionId}/mobile?q=02-00-00001`)
      .set(authorization(pairing.token)).expect(200);
    expect(response.body.lookup.asset).toMatchObject({ id: localAssetId, scannerCode: '0020000001' });
  });

  test('keeps barcode scanner engines outside runtime while allowing private photo evidence', () => {
    expect(mobileSource).not.toMatch(/mobile-scanner|BarcodeDetector|ZXing|getUserMedia|startCamera|cameraButton/);
    expect(mobileHtml).not.toMatch(/Escanear etiqueta|Intentar lectura|torch|zoom|zxing|camera-preview/i);
    expect(mobileHtml).not.toContain('/vendor/zxing-browser.min.js');
    expect(mobileHtml).toContain('Agregar foto');
    expect(mobileHtml).toMatch(/type="file"[^>]+capture="environment"/);
  });

  test('uses a manual-first form and submits with Enter or the Registrar button', () => {
    expect(mobileHtml).toContain('id="lookup-form"');
    expect(mobileHtml).toContain('inputmode="text"');
    expect(mobileHtml).toContain('Registrar');
    expect(mobileSource).toContain("elements.lookupForm.addEventListener('submit'");
    expect(mobileSource).toContain('await loadSession(code)');
  });

  test('automatically registers one correct match and returns focus to the code field', () => {
    const lookup = mobileSource.slice(
      mobileSource.indexOf('async function handleLookup'),
      mobileSource.indexOf('async function loadSession'),
    );
    expect(lookup).toContain("lookup.classification === 'corresponde'");
    expect(lookup).toContain("registerObservation({ lookup, status: 'verificado' })");
    expect(mobileSource).toContain('elements.code.focus()');
    expect(mobileSource).toContain('Bien registrado. Listo para el siguiente código.');
  });

  test('serializes the three independent incidence dimensions', () => {
    expect(serializeIncidence({
      identification: ['etiqueta_deteriorada', 'sin_etiqueta'],
      physical: ['no_operativo', 'propuesta_baja'],
      situation: ['en_reparacion'],
    })).toBe(
      '[IDENTIFICACION:etiqueta_deteriorada] [IDENTIFICACION:sin_etiqueta] '
      + '[ESTADO_FISICO:no_operativo] [ESTADO_FISICO:propuesta_baja] '
      + '[SITUACION:en_reparacion]',
    );
  });

  test('closed, cancelled or invalid access disables every manual registration control', () => {
    expect(mobileSource).toContain('function disableControls');
    expect(mobileSource).toContain("querySelectorAll('input, button')");
    expect(mobileSource).toContain("querySelectorAll('input, textarea, select, button')");
    expect(mobileSource).toContain('elements.incidenceMode.disabled = true');
  });

  test('reports private network information', async () => {
    const response = await request(app).get('/api/network-info').expect(200);
    expect(response.body).toEqual({
      port: 3180,
      source: 'provided-candidates',
      addresses: syntheticNetwork(),
      selected: syntheticNetwork()[0],
      warning: null,
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

  test('generating a link stores only one SHA-256 hash and not the original token', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    const rows = database.prepare(`
      SELECT token_hash AS tokenHash, revoked_at AS revokedAt
      FROM session_pairings WHERE inventory_session_id = ?
    `).all(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].tokenHash).not.toBe(pairing.token);
  });

  test('renewing immediately revokes the previous mobile link', async () => {
    const sessionId = await createSession();
    const previous = await pair(sessionId);
    const current = await pair(sessionId);

    const revoked = await request(app).get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(previous.token)).expect(401);
    expect(revoked.body.error).toContain('revocado');
    await request(app).get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(current.token)).expect(200);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM session_pairings
      WHERE inventory_session_id = ? AND revoked_at IS NULL
    `).get(sessionId).count).toBe(1);
  });

  test('concurrent pairing requests leave exactly one active token', async () => {
    const sessionId = await createSession();
    const responses = await Promise.all([
      request(app).post(`/api/sessions/${sessionId}/pair`),
      request(app).post(`/api/sessions/${sessionId}/pair`),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM session_pairings
      WHERE inventory_session_id = ? AND revoked_at IS NULL
    `).get(sessionId).count).toBe(1);
    const checks = await Promise.all(responses.map(({ body }) => request(app)
      .get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(body.pairing.token))));
    expect(checks.map(({ status }) => status).sort()).toEqual([200, 401]);
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
    const notebookSummary = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    expect(notebookSummary.body.summary).toMatchObject({
      bienesEsperadosRevisados: 1,
      bienesConformes: 1,
      porcentajeRevision: 50,
      pendientes: 1,
    });
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

  test('refuses to close a mobile session while expected assets remain pending', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    await request(app)
      .post(`/api/sessions/${sessionId}/mobile-observations`)
      .set(authorization(pairing.token))
      .send({ code: '0010000001', status: 'verificado', observation: '' })
      .expect(201);
    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(409);
    expect(closed.body.summary).toMatchObject({ pendientes: 1, pending: 1, status: 'open' });
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
    await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(200);
    await request(app)
      .get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(pairing.token))
      .expect(410);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM session_pairings
      WHERE inventory_session_id = ? AND revoked_at IS NULL
    `).get(sessionId).count).toBe(0);
  });

  test('cancellation requires a reason and explicit confirmation', async () => {
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/cancel`).send({}).expect(400);
    await request(app).post(`/api/sessions/${sessionId}/cancel`)
      .send({ reason: 'Motivo sintético válido', confirm: false }).expect(400);
    expect(database.prepare('SELECT status_code AS status FROM inventory_sessions WHERE id = ?')
      .get(sessionId).status).toBe('open');
  });

  test('cancellation preserves observations, revokes tokens and makes the session immutable', async () => {
    const sessionId = await createSession();
    const pairing = await pair(sessionId);
    await request(app).post(`/api/sessions/${sessionId}/mobile-observations`)
      .set(authorization(pairing.token))
      .send({ code: '0010000001', status: 'verificado', observation: '' }).expect(201);

    const cancelled = await request(app).post(`/api/sessions/${sessionId}/cancel`)
      .send({ reason: 'Cancelación sintética de regresión', confirm: true }).expect(200);
    expect(cancelled.body.summary).toMatchObject({
      status: 'cancelled', observations: 1, verifiedExpected: 1,
    });
    expect(cancelled.body.summary.cancelledAt).toBeTruthy();
    expect(cancelled.body.summary.cancellationReason).toBe('Cancelación sintética de regresión');
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id = ?')
      .get(sessionId).count).toBe(1);
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      provisionalCode: 'SINTETICO-NUEVO', status: 'desconocido', locationId,
      observation: 'No debe guardarse',
    }).expect(409);
    await request(app).post(`/api/sessions/${sessionId}/pair`).expect(409);
    await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(409);
    await request(app).get(`/api/sessions/${sessionId}/mobile`)
      .set(authorization(pairing.token)).expect(410);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM session_pairings
      WHERE inventory_session_id = ? AND revoked_at IS NULL
    `).get(sessionId).count).toBe(0);
  });

  test('cancelled sessions are not resumable but remain in history', async () => {
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/cancel`)
      .send({ reason: 'Historial sintético', confirm: true }).expect(200);
    const open = await request(app).get(`/api/sessions/open?locationId=${locationId}`).expect(200);
    expect(open.body.sessions).toEqual([]);
    const history = await request(app).get('/api/sessions/history').expect(200);
    expect(history.body.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sessionId, status: 'cancelled' }),
    ]));
  });

  test('mobile polling runs every 2500 ms without overlapping requests', () => {
    expect(mobileSource).toContain('setInterval(pollMobileSession, 2500)');
    expect(mobileSource).toContain('state.pollRunning');
    expect(mobileSource).toContain('new AbortController()');
    expect(mobileSource).toContain('state.registrationInProgress');
    expect(mobileSource).toContain('state.lookupInProgress');
    expect(mobileSource).not.toContain('state.scanning');
  });

  test('intentional AbortError is completely ignored by polling', () => {
    const tracker = createPollingFailureTracker();
    expect(tracker.recordFailure({ name: 'AbortError' })).toEqual({ action: 'ignore' });
    expect(tracker.consecutiveFailures).toBe(0);
  });

  test('one transient polling failure remains silent and the second shows Spanish warning', () => {
    const tracker = createPollingFailureTracker();
    expect(tracker.recordFailure(createSafeNetworkError())).toEqual({ action: 'retry' });
    expect(tracker.recordFailure(createSafeNetworkError())).toEqual({
      action: 'warn',
      message: temporaryConnectionMessage,
    });
    expect(temporaryConnectionMessage).toBe('Conexión temporalmente interrumpida. Intentando reconectar…');
  });

  test('successful polling clears the interruption and resets the failure counter', () => {
    const tracker = createPollingFailureTracker();
    tracker.recordFailure(createSafeNetworkError());
    tracker.recordFailure(createSafeNetworkError());
    expect(tracker.recordSuccess()).toEqual({ action: 'clear-warning' });
    expect(tracker.consecutiveFailures).toBe(0);
    expect(tracker.recordSuccess()).toEqual({ action: 'connected' });
  });

  test('technical browser errors are replaced and never printed by the polling path', () => {
    for (const technicalMessage of ['Failed to fetch', 'NetworkError', 'Load failed']) {
      const browserError = new TypeError(technicalMessage);
      const safeError = createSafeNetworkError(browserError);
      expect(safeError.message).not.toContain(technicalMessage);
    }
    const polling = mobileSource.slice(
      mobileSource.indexOf('async function pollMobileSession()'),
      mobileSource.indexOf('function startMobilePolling()'),
    );
    expect(polling).not.toContain('error.message');
  });

  test('terminal revoked-token errors remain terminal after later success callbacks', () => {
    const tracker = createPollingFailureTracker();
    const revoked = { status: 401, body: { error: 'Token de emparejamiento revocado.' } };
    expect(tracker.recordFailure(revoked).action).toBe('terminal');
    expect(tracker.recordSuccess()).toEqual({ action: 'ignore' });
    expect(tracker.isTerminal).toBe(true);
  });

  test('polling interruption preserves rendered metrics and active form values', () => {
    const polling = mobileSource.slice(
      mobileSource.indexOf('async function pollMobileSession()'),
      mobileSource.indexOf('function startMobilePolling()'),
    );
    expect(polling).not.toMatch(/renderSummary|progress\.value|code\.value|notes\.value|\.reset\(/);
    expect(polling).toContain('state.pollingFailures.recordFailure');
  });

  test('polling updates metrics without replacing active mobile input or lookup state', () => {
    const polling = mobileSource.slice(
      mobileSource.indexOf('async function pollMobileSession()'),
      mobileSource.indexOf('function startMobilePolling()'),
    );
    expect(polling).toContain("loadSession('',");
    expect(polling).not.toMatch(/\.reset\(|elements\.code\.value|elements\.notes\.value|renderLookup/);
    expect(mobileSource).toContain('elements.pendingLabel.textContent');
    expect(mobileSource).toContain('elements.conformancePercent.textContent');
  });

  test('remote close or cancellation stops polling and disables all registration controls', () => {
    expect(mobileSource).toContain('function disableEndedSession');
    expect(mobileSource).toContain('stopMobilePolling()');
    expect(mobileSource).toContain("error.status === 410");
    expect(mobileSource).toContain("querySelectorAll('input, textarea, select, button')");
  });

  test('notebook recovery does not create or persist a mobile token', () => {
    const recovery = notebookSource.slice(
      notebookSource.indexOf('async function recoverStoredSession()'),
      notebookSource.indexOf('elements.refreshPairing'),
    );
    const activation = notebookSource.slice(
      notebookSource.indexOf('async function activateSession'),
      notebookSource.indexOf('function showSessionConflict'),
    );
    expect(recovery).not.toContain('createPairing');
    expect(activation).not.toContain('createPairing');
    expect(notebookSource).not.toMatch(/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:token|pairing)/i);
    expect(notebookSource).toContain("elements.generatePairing.addEventListener('click'");
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
    await request(app).post(`/api/sessions/${sessionId}/mobile-incidences`)
      .set(authorization(pairing.token))
      .field('assetId', String(otherAssetId)).field('status', 'otra_ubicacion')
      .field('identification', JSON.stringify(['etiqueta_deteriorada']))
      .field('physical', '[]').field('situation', JSON.stringify(['otra_ubicacion']))
      .field('details', JSON.stringify({ label: 'deteriorada', situations: ['otra_ubicacion'], physicalPoint: { type: 'sala', reference: '' } }))
      .expect(201);
    const provisional = await request(app).post(`/api/sessions/${sessionId}/mobile-incidences`)
      .set(authorization(pairing.token))
      .field('status', 'desconocido').field('identification', JSON.stringify(['sin_etiqueta']))
      .field('physical', '[]').field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({ label: 'sin_etiqueta', situations: ['bien_no_registrado'], physicalPoint: { type: 'bodega', reference: '' }, provisional: { description: 'Equipo sintético adicional', observedCode: 'SINTETICO-MOVIL-01' } }))
      .expect(201);
    await request(app).post(`/api/sessions/${sessionId}/observations/${provisional.body.observation.id}/evidence-exceptions`)
      .send({ evidenceType: 'bien_completo', reasonCode: 'falla_tecnica', confirm: true, operatorCode: 'TEST', deviceCode: 'NOTEBOOK-TEST' })
      .expect(201);
    await mobile().send({
      code: '0010000002', status: 'no_ubicado',
      observation: '[ESTADO_FISICO:no_operativo] [ESTADO_FISICO:propuesta_baja] '
        + '[SITUACION:pendiente_revision] No ubicado sintético',
    }).expect(201);

    const expected = {
      observations: 4,
      verifiedExpected: 1,
      locationDifferences: 1,
      provisionalFindings: 1,
      bienesEsperadosRevisados: 2,
      noUbicados: 1,
      encontrados: 1,
      incidencias: 3,
      problemasIdentificacion: 2,
      malosNoOperativos: 1,
      propuestasBaja: 1,
      pendientesRevision: 1,
      pending: 0,
      progressPercent: 100,
    };
    const before = await request(app).get(`/api/sessions/${sessionId}/summary`).expect(200);
    expect(before.body.summary).toMatchObject(expected);
    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(200);
    expect(closed.body.summary).toMatchObject(expected);
  });
});
