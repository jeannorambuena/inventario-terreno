import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

const closePayload = {
  confirm: true,
  statement: 'field-review-complete',
  operatorCode: 'OPERADOR-SINTETICO',
  deviceCode: 'NOTEBOOK-SINTETICO',
};

let database;
let app;
let evidenceRoot;
let importId;
let locationId;
let assetIds;

function insertAsset(index, location = locationId, scannerCode = null) {
  return database.prepare(`
    INSERT INTO assets (asset_code, inventory_import_id, location_id, name, brand, model, serial_number, scanner_code)
    VALUES (?, ?, ?, ?, 'Marca sintética', 'Modelo sintético', ?, ?)
    RETURNING id
  `).get(
    `SYN-${String(index).padStart(6, '0')}`, importId, location,
    `Equipo sintético ${index}`, `SERIE-${index}`, scannerCode || `SCAN-${String(index).padStart(6, '0')}`,
  ).id;
}

async function createSession() {
  const response = await request(app).post('/api/sessions').send({
    locationId, operatorCode: 'OPERADOR-SINTETICO', deviceCode: 'NOTEBOOK-SINTETICO',
  }).expect(201);
  return response.body.session.id;
}

async function addEvidence(sessionId, observationId, type, bytes = 'synthetic-image') {
  return request(app).post(`/api/sessions/${sessionId}/observations/${observationId}/evidence`)
    .field('evidenceType', type)
    .field('operatorCode', 'OPERADOR-SINTETICO')
    .field('deviceCode', 'NOTEBOOK-SINTETICO')
    .attach('evidence', Buffer.from(bytes), { filename: `${type}.jpg`, contentType: 'image/jpeg' })
    .expect(201);
}

beforeEach(() => {
  evidenceRoot = mkdtempSync(join(tmpdir(), 'inventario-field-synthetic-'));
  database = openDatabase(':memory:');
  importId = database.prepare(`
    INSERT INTO inventory_imports (import_code, source_name, source_checksum, sheet_name, row_count)
    VALUES ('field-synthetic', 'synthetic.xlsx', 'checksum-synthetic', 'BD_SQL', 3)
    RETURNING id
  `).get().id;
  locationId = database.prepare(`
    INSERT INTO locations (location_code, name, direction, department, section)
    VALUES ('field-location', 'Ubicación sintética', 'Dirección sintética', 'Departamento sintético', 'Sección sintética')
    RETURNING id
  `).get().id;
  assetIds = [insertAsset(1), insertAsset(2), insertAsset(3)];
  app = createApp({ database, evidenceRoot });
});

afterEach(() => {
  database.close();
  rmSync(evidenceRoot, { recursive: true, force: true });
});

describe('field closure workflow', () => {
  test('blocks generic pending assets and closes only after every expected result is explicit', async () => {
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assetIds[0], status: 'verificado', locationId,
    }).expect(201);
    await request(app).post(`/api/sessions/${sessionId}/assets/${assetIds[1]}/not-found`)
      .send({ confirm: true, operatorCode: 'OPERADOR-SINTETICO', deviceCode: 'NOTEBOOK-SINTETICO' }).expect(201);

    const blocked = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(409);
    expect(blocked.body.error).toBe('Faltan 1 situaciones por resolver');
    expect(blocked.body.readiness).toMatchObject({ ready: false, metrics: { pending: 1, notFound: 1 } });

    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assetIds[2], status: 'verificado', locationId,
    }).expect(201);
    const readiness = await request(app).get(`/api/sessions/${sessionId}/closure-readiness`).expect(200);
    expect(readiness.body.readiness).toMatchObject({ ready: true, metrics: { pending: 0, correct: 2, notFound: 1 } });
    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(200);
    expect(closed.body.summary).toMatchObject({ status: 'closed', pendientes: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action_code = 'session_closed'").get().count).toBe(1);
  });

  test('generates a stable provisional id and requires sufficient description, location and evidence', async () => {
    const emptyLocation = database.prepare(`
      INSERT INTO locations (location_code, name) VALUES ('empty-field', 'Vacía sintética') RETURNING id
    `).get().id;
    const session = await request(app).post('/api/sessions').send({
      locationId: emptyLocation, operatorCode: 'OPERADOR-SINTETICO', deviceCode: 'NOTEBOOK-SINTETICO',
    }).expect(201);
    const sessionId = session.body.session.id;
    const rejected = await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('status', 'desconocido').field('identification', JSON.stringify(['sin_etiqueta']))
      .field('physical', '[]').field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({ situations: ['bien_no_registrado'] })).expect(400);
    expect(rejected.body.validationErrors.map(({ code }) => code)).toContain('provisional_description');

    const created = await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('status', 'desconocido').field('identification', JSON.stringify(['sin_etiqueta']))
      .field('physical', '[]').field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({
        label: 'sin_etiqueta', situations: ['bien_no_registrado'],
        physicalPoint: { type: 'bodega', reference: 'Estante sintético' },
        provisional: { description: 'Equipo adicional sintético', observedCode: 'VISIBLE-0001' },
      })).expect(201);
    expect(created.body.observation.provisionalCode).toBe(`PROV-S${sessionId}-0001`);
    const blocked = await request(app).get(`/api/sessions/${sessionId}/closure-readiness`).expect(200);
    expect(blocked.body.readiness.blockers).toContainEqual(expect.objectContaining({ code: 'required_evidence_missing' }));
    await addEvidence(sessionId, created.body.observation.id, 'bien_completo');
    const ready = await request(app).get(`/api/sessions/${sessionId}/closure-readiness`).expect(200);
    expect(ready.body.readiness.ready).toBe(true);
  });

  test('stores multiple typed evidence records with hashes and detects missing or altered files', async () => {
    const sessionId = await createSession();
    const incidence = await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('assetId', String(assetIds[0])).field('status', 'dato_distinto')
      .field('identification', JSON.stringify(['datos_no_coinciden']))
      .field('physical', '[]').field('situation', '[]')
      .field('details', JSON.stringify({ discrepancies: [{ field: 'serialNumber', masterValue: 'SERIE-1', observedValue: 'SERIE-X' }] }))
      .expect(201);
    await addEvidence(sessionId, incidence.body.observation.id, 'bien_completo', 'image-one');
    await addEvidence(sessionId, incidence.body.observation.id, 'serie_modelo', 'image-two');
    const list = await request(app).get(`/api/sessions/${sessionId}/observations/${incidence.body.observation.id}/evidence`).expect(200);
    expect(list.body.evidence).toHaveLength(2);
    expect(list.body.evidence.every(({ available }) => available)).toBe(true);
    const rows = database.prepare('SELECT relative_path AS path, sha256 FROM evidence_files ORDER BY id').all();
    expect(rows.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
    writeFileSync(join(evidenceRoot, rows[1].path), 'tampered-synthetic-image');
    const altered = await request(app).get(`/api/sessions/${sessionId}/observations/${incidence.body.observation.id}/evidence`).expect(200);
    expect(altered.body.evidence).toContainEqual(expect.objectContaining({ state: 'invalid', available: false }));
    unlinkSync(join(evidenceRoot, rows[0].path));
    const readiness = await request(app).get(`/api/sessions/${sessionId}/closure-readiness`).expect(200);
    expect(readiness.body.readiness.blockers).toContainEqual(expect.objectContaining({ code: 'evidence_unavailable' }));
  });

  test('annuls incorrect evidence without deleting its file and records the action', async () => {
    const sessionId = await createSession();
    const incidence = await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('assetId', String(assetIds[0])).field('status', 'dato_distinto')
      .field('identification', JSON.stringify(['datos_no_coinciden']))
      .field('physical', '[]').field('situation', '[]')
      .field('details', JSON.stringify({ discrepancies: [{ field: 'brand', masterValue: 'Marca sintética', observedValue: 'Otra marca sintética' }] }))
      .expect(201);
    await addEvidence(sessionId, incidence.body.observation.id, 'serie_modelo');
    const stored = database.prepare('SELECT id, relative_path AS path FROM evidence_files').get();
    await request(app).post(`/api/sessions/${sessionId}/observations/${incidence.body.observation.id}/evidence/${stored.id}/annul`)
      .send({ reasonCode: 'evidencia_incorrecta', operatorCode: 'OPERADOR-SINTETICO', deviceCode: 'NOTEBOOK-SINTETICO' })
      .expect(200);
    expect(database.prepare('SELECT active FROM evidence_files WHERE id = ?').get(stored.id).active).toBe(0);
    expect(() => writeFileSync(join(evidenceRoot, stored.path), 'must-not-overwrite', { flag: 'wx' })).toThrow();
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action_code = 'evidence_annulled'").get().count).toBe(1);
    const visible = await request(app).get(`/api/sessions/${sessionId}/observations/${incidence.body.observation.id}/evidence`).expect(200);
    expect(visible.body.evidence).toEqual([]);
  });

  test('rejects incomplete discrepancies and contradictory category combinations', async () => {
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('assetId', String(assetIds[0])).field('status', 'dato_distinto')
      .field('identification', JSON.stringify(['datos_no_coinciden']))
      .field('physical', '[]').field('situation', '[]')
      .field('details', JSON.stringify({ discrepancyIndicated: true, discrepancies: [{ field: 'brand', masterValue: 'A' }] }))
      .expect(400);
    await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('assetId', String(assetIds[0])).field('status', 'dato_distinto')
      .field('identification', JSON.stringify(['sin_etiqueta', 'etiqueta_ilegible']))
      .field('physical', '[]').field('situation', '[]')
      .field('details', JSON.stringify({ label: 'sin_etiqueta' }))
      .expect(400);
  });

  test('corrects a non-last active observation by versioning it and preserving audit and evidence links', async () => {
    const sessionId = await createSession();
    const first = await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assetIds[0], status: 'verificado', locationId,
    }).expect(201);
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assetIds[1], status: 'verificado', locationId,
    }).expect(201);
    await addEvidence(sessionId, first.body.observation.id, 'bien_completo');
    const corrected = await request(app).post(`/api/sessions/${sessionId}/observations/${first.body.observation.id}/correct`).send({
      expectedObservationCode: first.body.observation.observationCode,
      action: 'correct', reasonCode: 'error_clasificacion',
      operatorCode: 'OPERADOR-SINTETICO', deviceCode: 'NOTEBOOK-SINTETICO',
      status: 'dato_distinto',
      details: { discrepancies: [{ field: 'brand', masterValue: 'Marca sintética', observedValue: 'Marca corregida' }] },
    }).expect(200);
    expect(corrected.body.observation).toMatchObject({ versionNumber: 2, supersedesObservationId: first.body.observation.id });
    expect(database.prepare('SELECT active FROM observations WHERE id = ?').get(first.body.observation.id).active).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM evidence_files WHERE observation_id = ?').get(corrected.body.observation.id).count).toBe(1);
    const audit = database.prepare("SELECT details_json AS details FROM audit_log WHERE action_code = 'observation_corrected'").get();
    expect(JSON.parse(audit.details)).toMatchObject({ details: { reasonCode: 'error_clasificacion' } });
  });

  test('enforces active uniqueness in SQLite and keeps an observed duplicate candidate from blocking another', async () => {
    const duplicateScanner = 'SCAN-DUPLICADO';
    database.prepare('UPDATE assets SET scanner_code = ? WHERE id = ?').run(duplicateScanner, assetIds[0]);
    database.prepare('UPDATE assets SET scanner_code = ? WHERE id = ?').run(duplicateScanner, assetIds[1]);
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assetIds[0], status: 'verificado', locationId,
    }).expect(201);
    const lookup = await request(app).get(`/api/assets/by-code/${duplicateScanner}?sessionId=${sessionId}`).expect(200);
    expect(lookup.body.lookup.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assetIds[0], alreadyObserved: true }),
      expect.objectContaining({ id: assetIds[1], alreadyObserved: false }),
    ]));
    await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assetIds[1], status: 'verificado', locationId, lookupCode: duplicateScanner,
    }).expect(201);
    expect(() => database.prepare(`
      INSERT INTO observations (observation_code, inventory_session_id, asset_id, status_code, selected_location_id, observed_at)
      VALUES ('duplicate-direct', ?, ?, 'verificado', ?, '2026-01-01T00:00:00.000Z')
    `).run(sessionId, assetIds[1], locationId)).toThrow(/UNIQUE/);
    const readiness = await request(app).get(`/api/sessions/${sessionId}/closure-readiness`).expect(200);
    expect(readiness.body.readiness.blockers).not.toContainEqual(expect.objectContaining({ code: 'unresolved_ambiguity' }));
  });
});
