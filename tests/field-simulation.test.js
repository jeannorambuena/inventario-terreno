import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';
import { getEvidencePolicy, normalizeFieldDetails, validateFieldDetails } from '../src/field-operations.js';

const identity = { operatorCode: 'OPERADOR-SIMULACION', deviceCode: 'NOTEBOOK-SIMULACION' };
const closePayload = { confirm: true, statement: 'field-review-complete', ...identity };
let database;
let app;
let evidenceRoot;
let importId;
let locationId;
let otherLocationId;
let assets;
let otherAssets;

function insertLocation(code) {
  return database.prepare(`INSERT INTO locations (location_code, name, direction, department, section)
    VALUES (?, ?, 'Dirección sintética', 'Departamento sintético', ?) RETURNING id`)
    .get(code, `Ubicación ${code}`, `Sección ${code}`).id;
}

function insertAsset(index, targetLocation = locationId, scannerCode = '') {
  return database.prepare(`INSERT INTO assets
    (asset_code, inventory_import_id, location_id, name, brand, model, serial_number, scanner_code)
    VALUES (?, ?, ?, ?, 'Marca sintética', 'Modelo sintético', ?, ?) RETURNING id`)
    .get(`SIM-${String(index).padStart(6, '0')}`, importId, targetLocation,
      `Bien sintético ${index}`, `SERIE-SIM-${index}`, scannerCode || `SCAN-SIM-${String(index).padStart(6, '0')}`).id;
}

async function addEvidence(sessionId, observationId, type, content) {
  return request(app).post(`/api/sessions/${sessionId}/observations/${observationId}/evidence`)
    .field('evidenceType', type).field('operatorCode', identity.operatorCode).field('deviceCode', identity.deviceCode)
    .attach('evidence', Buffer.from(content), { filename: `${type}.jpg`, contentType: 'image/jpeg' }).expect(201);
}

async function incidence(sessionId, { assetId, status = 'dato_distinto', identification = [], physical = [], situation = [], details }) {
  const response = request(app).post(`/api/sessions/${sessionId}/incidences`)
    .field('status', status).field('identification', JSON.stringify(identification))
    .field('physical', JSON.stringify(physical)).field('situation', JSON.stringify(situation))
    .field('details', JSON.stringify(details)).field('operatorCode', identity.operatorCode).field('deviceCode', identity.deviceCode);
  if (assetId) response.field('assetId', String(assetId));
  return response.expect(201);
}

beforeEach(() => {
  evidenceRoot = mkdtempSync(join(tmpdir(), 'inventario-simulation-'));
  database = openDatabase(':memory:');
  importId = database.prepare(`INSERT INTO inventory_imports
    (import_code, source_name, source_checksum, sheet_name, row_count)
    VALUES ('simulation-50', 'synthetic-only.xlsx', 'synthetic-checksum', 'SYNTHETIC', 53) RETURNING id`).get().id;
  locationId = insertLocation('SIM-A');
  otherLocationId = insertLocation('SIM-B');
  assets = Array.from({ length: 50 }, (_, index) => insertAsset(index + 1));
  otherAssets = Array.from({ length: 3 }, (_, index) => insertAsset(101 + index, otherLocationId));
  app = createApp({ database, evidenceRoot, networkInfoProvider: () => [{ address: '192.168.50.10' }] });
});

afterEach(() => {
  database.close();
  rmSync(evidenceRoot, { recursive: true, force: true });
});

describe('simulación operacional completa de 50 bienes', () => {
  test('resuelve terreno, fallos de evidencia, concurrencia, corrección y cierre sin pendientes', async () => {
    const created = await request(app).post('/api/sessions').send({ locationId, ...identity }).expect(201);
    const sessionId = created.body.session.id;
    database.prepare('UPDATE assets SET scanner_code = ? WHERE id IN (?, ?)').run('CODIGO-AMBIGUO-SINTETICO', assets[0], otherAssets[0]);
    const ambiguous = await request(app).get(`/api/assets/by-code/CODIGO-AMBIGUO-SINTETICO?sessionId=${sessionId}`).expect(200);
    expect(ambiguous.body.lookup.matches).toHaveLength(2);

    const first = await request(app).post(`/api/sessions/${sessionId}/observations`).send({
      assetId: assets[0], status: 'verificado', locationId, lookupCode: 'CODIGO-AMBIGUO-SINTETICO', ...identity,
    }).expect(201);
    const doubleEntry = await Promise.all([
      request(app).post(`/api/sessions/${sessionId}/observations`).send({ assetId: assets[1], status: 'verificado', locationId, ...identity }),
      request(app).post(`/api/sessions/${sessionId}/observations`).send({ assetId: assets[1], status: 'verificado', locationId, ...identity }),
    ]);
    expect(doubleEntry.map(({ status }) => status).sort()).toEqual([201, 409]);
    for (const assetId of assets.slice(2, 18)) {
      await request(app).post(`/api/sessions/${sessionId}/observations`).send({ assetId, status: 'verificado', locationId, ...identity }).expect(201);
    }

    const pairing = await request(app).post(`/api/sessions/${sessionId}/pair`).expect(201);
    await request(app).get(`/api/sessions/${sessionId}/mobile`).set('Authorization', `Bearer ${pairing.body.pairing.token}`).expect(200);
    await request(app).get(`/api/sessions/${sessionId}/mobile`).set('Authorization', 'Bearer TOKEN-SINTETICO-INVALIDO').expect(401);
    for (const assetId of assets.slice(18, 35)) {
      await request(app).post(`/api/sessions/${sessionId}/mobile-observations`)
        .set('Authorization', `Bearer ${pairing.body.pairing.token}`)
        .send({ assetId, code: `SIM-${String(assets.indexOf(assetId) + 1).padStart(6, '0')}`, status: 'verificado', deviceCode: 'MOVIL-SIMULACION' })
        .expect(201);
    }
    await request(app).get(`/api/sessions/${sessionId}/mobile`).set('Authorization', `Bearer ${pairing.body.pairing.token}`).expect(200);

    for (const assetId of assets.slice(35, 39)) {
      await request(app).post(`/api/sessions/${sessionId}/assets/${assetId}/not-found`).send({ confirm: true, ...identity }).expect(201);
    }

    const expectedIncidences = [
      { identification: ['sin_etiqueta'], details: { label: 'sin_etiqueta' } },
      { identification: ['sin_etiqueta'], details: { label: 'sin_etiqueta' } },
      { identification: ['etiqueta_ilegible'], details: { label: 'ilegible' } },
      { physical: ['no_operativo'], details: { functionality: 'no_operativo' } },
      { physical: ['no_operativo'], details: { functionality: 'no_operativo' } },
      { physical: ['propuesta_baja'], details: { proposedDisposal: true } },
      { identification: ['datos_no_coinciden'], details: { discrepancies: [{ field: 'brand', masterValue: 'Marca sintética', observedValue: 'Marca sintética B' }] } },
      { identification: ['pendiente_identificar'], details: { physicalPoint: { type: 'sala' }, provisional: { pendingIdentification: true } } },
      { physical: ['incompleto'], details: { physicalCondition: 'incompleto', incomplete: { parts: ['cable'] } } },
      { situation: ['prestamo_informado'], details: { situations: ['prestamo_informado'], custody: { destination: 'Unidad sintética', basis: 'informado' } } },
      { situation: ['en_reparacion', 'requiere_revision'], details: { situations: ['en_reparacion', 'requiere_revision'], physicalPoint: { type: 'bodega' }, custody: { destination: 'Taller sintético', basis: 'informado' }, review: { reason: 'documentacion' } } },
    ];
    const incidenceRows = [];
    for (let index = 0; index < expectedIncidences.length; index += 1) {
      const entry = expectedIncidences[index];
      const saved = await incidence(sessionId, { assetId: assets[39 + index], ...entry });
      incidenceRows.push(saved.body.observation);
    }
    await addEvidence(sessionId, incidenceRows[7].id, 'bien_completo', 'pending-identification-full');
    await addEvidence(sessionId, incidenceRows[7].id, 'serie_modelo', 'pending-identification-label');

    for (const assetId of otherAssets) {
      await incidence(sessionId, {
        assetId, status: 'otra_ubicacion', situation: ['otra_ubicacion'],
        details: { situations: ['otra_ubicacion'], physicalPoint: { type: 'sala', reference: 'Punto sintético' } },
      });
    }
    const provisionals = [];
    for (const index of [1, 2]) {
      const saved = await incidence(sessionId, {
        status: 'desconocido', identification: ['sin_etiqueta'], situation: ['bien_no_registrado'],
        details: { label: 'sin_etiqueta', situations: ['bien_no_registrado'], physicalPoint: { type: 'bodega', reference: `Estante ${index}` }, provisional: { description: `Hallazgo adicional sintético ${index}`, observedCode: `VISIBLE-${index}` } },
      });
      provisionals.push(saved.body.observation);
      if (index === 1) {
        const requiredPhotoBlocked = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(409);
        expect(requiredPhotoBlocked.body.readiness.blockers).toContainEqual(expect.objectContaining({ code: 'required_evidence_missing' }));
      }
      await addEvidence(sessionId, saved.body.observation.id, 'bien_completo', `provisional-${index}`);
    }
    expect(provisionals.map(({ provisionalCode }) => provisionalCode)).toEqual([`PROV-S${sessionId}-0001`, `PROV-S${sessionId}-0002`]);

    const accidental = await incidence(sessionId, {
      status: 'desconocido', identification: ['sin_etiqueta'], situation: ['bien_no_registrado'],
      details: { label: 'sin_etiqueta', situations: ['bien_no_registrado'], physicalPoint: { type: 'sala' }, provisional: { description: 'Registro accidental sintético' } },
    });
    await request(app).post(`/api/sessions/${sessionId}/observations/${accidental.body.observation.id}/correct`).send({
      expectedObservationCode: accidental.body.observation.observationCode, action: 'annul', reasonCode: 'registro_equivocado', ...identity,
    }).expect(200);

    const missingEvidence = await addEvidence(sessionId, incidenceRows[0].id, 'etiqueta_patrimonial', 'will-be-missing');
    const missingRow = database.prepare('SELECT id, relative_path AS path FROM evidence_files WHERE id = ?').get(missingEvidence.body.evidence.id);
    unlinkSync(join(evidenceRoot, missingRow.path));
    let premature = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(409);
    expect(premature.body.readiness.blockers).toContainEqual(expect.objectContaining({ code: 'evidence_unavailable' }));
    await request(app).post(`/api/sessions/${sessionId}/observations/${incidenceRows[0].id}/evidence/${missingRow.id}/annul`)
      .send({ reasonCode: 'evidencia_incorrecta', ...identity }).expect(200);

    const invalidEvidence = await addEvidence(sessionId, incidenceRows[1].id, 'etiqueta_patrimonial', 'valid-before-tamper');
    const invalidRow = database.prepare('SELECT id, relative_path AS path FROM evidence_files WHERE id = ?').get(invalidEvidence.body.evidence.id);
    writeFileSync(join(evidenceRoot, invalidRow.path), 'tampered');
    premature = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(409);
    expect(premature.body.readiness.blockers).toContainEqual(expect.objectContaining({ code: 'evidence_unavailable' }));
    await request(app).post(`/api/sessions/${sessionId}/observations/${incidenceRows[1].id}/evidence/${invalidRow.id}/annul`)
      .send({ reasonCode: 'evidencia_incorrecta', ...identity }).expect(200);

    const corrected = await request(app).post(`/api/sessions/${sessionId}/observations/${first.body.observation.id}/correct`).send({
      expectedObservationCode: first.body.observation.observationCode, action: 'correct', reasonCode: 'error_dato',
      status: 'verificado', ...identity,
    }).expect(200);
    expect(corrected.body.observation.versionNumber).toBe(2);

    const readiness = await request(app).get(`/api/sessions/${sessionId}/closure-readiness`).expect(200);
    expect(readiness.body.readiness).toMatchObject({ ready: true, metrics: { expected: 50, pending: 0, notFound: 4, additional: 2, otherLocation: 3 } });
    const closed = await request(app).post(`/api/sessions/${sessionId}/close`).send(closePayload).expect(200);
    expect(closed.body.summary).toMatchObject({ status: 'closed', pendientes: 0, bienesEsperadosRevisados: 50 });
    const report = await request(app).get(`/api/sessions/${sessionId}/report`).expect(200);
    expect(report.body.report).toMatchObject({ corrections: 1, annulments: 3 });
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.prepare('SELECT COUNT(*) AS count FROM evidence_files e LEFT JOIN observations o ON o.id=e.observation_id WHERE o.id IS NULL').get().count).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations o LEFT JOIN inventory_sessions s ON s.id=o.inventory_session_id WHERE s.id IS NULL').get().count).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id=? AND active=1 GROUP BY asset_id HAVING asset_id IS NOT NULL AND COUNT(*)>1').all(sessionId)).toEqual([]);
    expect(existsSync(join(evidenceRoot, invalidRow.path))).toBe(true);
  });

  test('the no-return rules make every required incidence category structurally sufficient', () => {
    const cases = [
      { assetId: null, status: 'desconocido', details: { situations: ['bien_no_registrado'], physicalPoint: { type: 'sala' }, provisional: { description: 'Hallazgo sintético' } }, evidence: ['bien_completo'] },
      { assetId: 1, status: 'dato_distinto', details: { label: 'ilegible' } },
      { assetId: 1, status: 'dato_distinto', details: { discrepancies: [{ field: 'model', masterValue: 'M1', observedValue: 'M2' }] } },
      { assetId: 1, status: 'otra_ubicacion', details: { situations: ['otra_ubicacion'], physicalPoint: { type: 'sala' } } },
      { assetId: 1, status: 'dato_distinto', details: { physicalCondition: 'incompleto', incomplete: { parts: ['cable'] } } },
      { assetId: 1, status: 'dato_distinto', details: { functionality: 'no_operativo' } },
      { assetId: 1, status: 'dato_distinto', details: { proposedDisposal: true } },
      { assetId: 1, status: 'dato_distinto', details: { situations: ['prestamo_informado'], custody: { destination: 'Unidad sintética', basis: 'informado' } } },
      { assetId: 1, status: 'dato_distinto', details: { situations: ['en_reparacion'], custody: { destination: 'Taller sintético', basis: 'informado' } } },
      { assetId: 1, status: 'dato_distinto', details: { situations: ['traslado_no_regularizado'], physicalPoint: { type: 'bodega' }, custody: { destination: 'Destino sintético', basis: 'informado' } } },
      { assetId: 1, status: 'dato_distinto', details: { situations: ['requiere_revision'], physicalPoint: { type: 'sala' }, review: { reason: 'documentacion' } } },
    ];
    for (const item of cases) {
      const details = normalizeFieldDetails(item.details);
      expect(validateFieldDetails({ ...item, details })).toEqual([]);
      const policy = getEvidencePolicy({ ...item, details });
      expect(policy.required.every((type) => item.evidence?.includes(type))).toBe(true);
    }
  });
});

describe('rendimiento de listas sintéticas', () => {
  test.each([50, 200, 500])('returns %i pending assets without corrupting the database', async (size) => {
    const isolatedLocation = insertLocation(`PERF-${size}`);
    for (let index = 0; index < size; index += 1) insertAsset(1000 + size * 10 + index, isolatedLocation);
    const session = await request(app).post('/api/sessions').send({ locationId: isolatedLocation, ...identity }).expect(201);
    const started = performance.now();
    const pending = await request(app).get(`/api/sessions/${session.body.session.id}/pending-assets`).expect(200);
    expect(pending.body.assets).toHaveLength(size);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});
