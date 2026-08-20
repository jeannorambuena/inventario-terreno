import request from 'supertest';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';
import { safeSpreadsheetValue } from '../public/csv-safety.js';

let database;
let app;
let importId;
let sectionA;
let sectionB;
let sectionC;
let sessionId;
let assets;

function insertAsset(code, locationId, name = `Bien ${code}`) {
  return database.prepare(`
    INSERT INTO assets (
      asset_code, inventory_import_id, location_id, name, brand,
      model, serial_number, scanner_code
    ) VALUES (?, ?, ?, ?, 'Marca sintética', 'Modelo sintético', ?, ?)
    RETURNING id
  `).get(code, importId, locationId, name, `SER-${code}`, `SCAN-${code}`).id;
}

function insertObservation({ code, assetId = null, provisionalCode = null, status, notes = '', details = {} }) {
  const id = database.prepare(`
    INSERT INTO observations (
      observation_code, inventory_session_id, asset_id, provisional_code,
      status_code, selected_location_id, notes, observed_at,
      operator_code, device_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-08-20T12:00:00.000Z',
      'OPERADOR-SINTETICO', 'NOTEBOOK-SINTETICO')
    RETURNING id
  `).get(code, sessionId, assetId, provisionalCode, status, sectionA, notes).id;
  database.prepare(`
    INSERT INTO observation_details (observation_id, details_json)
    VALUES (?, ?)
  `).run(id, JSON.stringify(details));
  return id;
}

beforeEach(() => {
  database = openDatabase(':memory:');
  importId = database.prepare(`
    INSERT INTO inventory_imports (
      import_code, source_name, source_checksum, sheet_name, row_count, created_at
    ) VALUES ('conciliacion-sintetica', 'maestro-sintetico.xlsx',
      'checksum-sintetico', 'BD_SQL', 7, '2026-08-19T10:00:00.000Z')
    RETURNING id
  `).get().id;
  const insertLocation = database.prepare(`
    INSERT INTO locations (location_code, name, description, direction, department, section)
    VALUES (?, 'Oficina física compartida', 'Misma sala física, adscripción administrativa separada', ?, ?, ?)
    RETURNING id
  `);
  sectionA = insertLocation.get('SEC-A', 'Dirección sintética', 'Departamento sintético', 'Sección A').id;
  sectionB = insertLocation.get('SEC-B', 'Dirección sintética', 'Departamento sintético', 'Sección B').id;
  sectionC = insertLocation.get('SEC-C', 'Otra dirección sintética', 'Otro departamento sintético', 'Sección C').id;
  assets = {
    conforming: insertAsset('0001-A', sectionA),
    differing: insertAsset('0002-A', sectionA),
    missing: insertAsset('0003-A', sectionA),
    pending: insertAsset('0004-A', sectionA),
    disposal: insertAsset('0005-A', sectionA),
    otherOffice: insertAsset('0001-B', sectionB),
    thirdSection: insertAsset('0001-C', sectionC),
  };
  sessionId = database.prepare(`
    INSERT INTO inventory_sessions (
      session_code, location_id, status_code, started_at, completed_at,
      operator_code, device_code
    ) VALUES ('SESION-CONCILIACION-SINTETICA', ?, 'closed',
      '2026-08-20T11:00:00.000Z', '2026-08-20T13:00:00.000Z',
      'OPERADOR-SINTETICO', 'NOTEBOOK-SINTETICO')
    RETURNING id
  `).get(sectionA).id;

  insertObservation({ code: 'OBS-1', assetId: assets.conforming, status: 'verificado' });
  const differingObservation = insertObservation({
    code: 'OBS-2', assetId: assets.differing, status: 'dato_distinto',
    notes: '[IDENTIFICACION:etiqueta_ilegible] [IDENTIFICACION:datos_no_coinciden] [ESTADO_FISICO:no_operativo] [SITUACION:requiere_revision]',
    details: {
      label: 'ilegible', situations: ['requiere_revision'],
      discrepancies: [{ field: 'model', masterValue: 'Modelo sintético', observedValue: 'Modelo observado' }],
      physicalPoint: { type: 'oficina', reference: 'Puesto 2' },
    },
  });
  insertObservation({ code: 'OBS-3', assetId: assets.missing, status: 'no_ubicado' });
  insertObservation({
    code: 'OBS-4', assetId: assets.disposal, status: 'dato_distinto',
    notes: '[ESTADO_FISICO:propuesta_baja]', details: { proposedDisposal: true },
  });
  insertObservation({
    code: 'OBS-5', assetId: assets.otherOffice, status: 'otra_ubicacion',
    notes: '[SITUACION:otra_ubicacion] [SITUACION:traslado_no_regularizado]',
    details: { situations: ['otra_ubicacion', 'traslado_no_regularizado'] },
  });
  insertObservation({
    code: 'OBS-6', provisionalCode: `PROV-S${sessionId}-0001`, status: 'desconocido',
    notes: '[IDENTIFICACION:sin_etiqueta] [SITUACION:bien_no_registrado] [SITUACION:bien_tercero]',
    details: {
      situations: ['bien_no_registrado', 'bien_tercero'],
      provisional: { description: 'Impresora adicional sintética', brand: 'Marca X', model: 'M1', serialNumber: 'S1' },
      physicalPoint: { type: 'oficina', reference: 'Mesa común' },
    },
  });
  database.prepare(`
    INSERT INTO evidence_files (
      evidence_code, inventory_session_id, observation_id, evidence_type,
      relative_path, mime_type, byte_size, sha256
    ) VALUES ('EVID-SINTETICA', ?, ?, 'serie_modelo',
      'synthetic/evidence.jpg', 'image/jpeg', 42, ?)
  `).run(sessionId, differingObservation, 'a'.repeat(64));
  app = createApp({ database });
});

afterEach(() => database.close());

describe('conciliación física y administrativa', () => {
  test('consulta la ubicación maestra y permite omitir otra sección sin crear observaciones', async () => {
    const before = database.prepare('SELECT COUNT(*) AS count FROM observations').get().count;
    const own = await request(app).get(`/api/assets/by-code/SCAN-0001-A?sessionId=${sessionId}`).expect(200);
    const other = await request(app).get(`/api/assets/by-code/SCAN-0001-C?sessionId=${sessionId}`).expect(200);
    expect(own.body.asset).toMatchObject({
      classification: 'corresponde', direction: 'Dirección sintética',
      department: 'Departamento sintético', section: 'Sección A',
    });
    expect(other.body.asset).toMatchObject({
      classification: 'otra_ubicacion', direction: 'Otra dirección sintética',
      department: 'Otro departamento sintético', section: 'Sección C',
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM observations').get().count).toBe(before);
  });

  test('concilia maestro, hallazgos y otra ubicación sin reclasificar ni duplicar', async () => {
    const masterBefore = database.prepare(`
      SELECT id, asset_code AS code, location_id AS locationId, name, brand, model, serial_number AS serial
      FROM assets ORDER BY id
    `).all();
    const response = await request(app).get(`/api/sessions/${sessionId}/reconciliation`).expect(200);
    const report = response.body.reconciliation;

    expect(report.status).toBe('FINAL');
    expect(report.rows).toHaveLength(7);
    expect(report.rows.filter(({ kind }) => kind === 'additional_finding')).toHaveLength(1);
    expect(report.rows.filter(({ code }) => code === '0002-A')).toHaveLength(1);
    expect(report.rows.find(({ code }) => code === '0004-A')).toMatchObject({
      outcomeCode: 'pendiente', masterLocation: { section: 'Sección A' }, observedLocation: null,
    });
    expect(report.rows.find(({ code }) => code === '0001-B')).toMatchObject({
      kind: 'master_asset', outcomeCode: 'otra_ubicacion',
      masterLocation: { section: 'Sección B' }, observedLocation: { section: 'Sección A' },
    });
    const difference = report.rows.find(({ code }) => code === '0002-A');
    expect(difference.incidences.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'etiqueta_ilegible', 'datos_no_coinciden', 'no_operativo', 'requiere_revision',
    ]));
    expect(difference.proposedActions.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'correct_label', 'update_master', 'review_required',
    ]));
    expect(difference.evidence[0]).toMatchObject({ sha256: 'a'.repeat(64) });
    expect(difference.traceabilityUrl).toContain('trace=0002-A');
    const provisional = report.rows.find(({ kind }) => kind === 'additional_finding');
    expect(provisional).toMatchObject({
      masterLocation: null, observedLocation: { section: 'Sección A' },
      propertyBasis: 'TERCERO INFORMADO / PROPIEDAD NO ACREDITADA',
    });
    expect(provisional.proposedActions.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'review_registration', 'review_ownership',
    ]));
    expect(database.prepare(`
      SELECT id, asset_code AS code, location_id AS locationId, name, brand, model, serial_number AS serial
      FROM assets ORDER BY id
    `).all()).toEqual(masterBefore);
  });

  test('produce el mismo resumen y digest para el mismo corte', async () => {
    const first = (await request(app).get(`/api/sessions/${sessionId}/reconciliation`).expect(200)).body.reconciliation;
    const second = (await request(app).get(`/api/sessions/${sessionId}/reconciliation`).expect(200)).body.reconciliation;
    expect(second.summary).toEqual(first.summary);
    expect(second.digestSha256).toBe(first.digestSha256);
    expect(second.snapshotAt).toBe(first.snapshotAt);
  });
});

describe('exportación tabular segura', () => {
  test.each(['=1+1', '+SUM(A1:A2)', '-10+20', '@cmd', '  =HYPERLINK("x")'])(
    'neutraliza valores interpretables como fórmula: %s',
    (value) => expect(safeSpreadsheetValue(value)).toBe(`'${value}`),
  );

  test('no altera texto ordinario ni códigos con cero inicial', () => {
    expect(safeSpreadsheetValue('00001234')).toBe('00001234');
    expect(safeSpreadsheetValue('Bien sintético')).toBe('Bien sintético');
  });

  test('mantiene controles fuera de la impresión y ofrece las dos salidas formales', () => {
    const html = readFileSync(new URL('../public/reports.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../public/reports.css', import.meta.url), 'utf8');
    expect(html).toContain('id="export-reconciliation-csv"');
    expect(html).toContain('id="print-reconciliation"');
    expect(html).toContain('class="reconciliation-actions no-print"');
    expect(css).toContain('body.print-reconciliation .no-print');
    expect(css).toContain('body.print-reconciliation #reconciliation-sheet');
    expect(css).toContain('.reconciliation-table thead { display: table-header-group; }');
  });
});
