import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  buildConsultationRows,
  consultationAssetStatus,
  consultationLocationLabel,
  consultationSectionState,
  createConsultationState,
  filterConsultationRows,
  findOverviewSection,
  flattenOverviewSections,
  normalizeConsultationText,
} from '../public/inventory-consultation.js';
import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

const notebookHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const notebookSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

const syntheticOverview = {
  directions: [{
    departments: [{
      sections: [
        { locationId: 1, state: 'en_proceso', sessionId: 10 },
        { locationId: 2, state: 'finalizada', sessionId: 20 },
        { locationId: 3, state: 'sin_iniciar', sessionId: null },
      ],
    }],
  }],
};

describe('pure read-only inventory consultation model', () => {
  test('creates fresh consultation state without operational identifiers', () => {
    expect(createConsultationState()).toMatchObject({ locationId: null, rows: [], filter: 'all' });
    expect(createConsultationState()).not.toHaveProperty('sessionId');
  });

  test('does not share mutable collections between consultation instances', () => {
    const first = createConsultationState();
    const second = createConsultationState();
    first.rows.push({ id: 1 });
    expect(second.rows).toEqual([]);
  });

  test('flattens all overview sections', () => {
    expect(flattenOverviewSections(syntheticOverview)).toHaveLength(3);
  });

  test('finds a section by numeric or string location id', () => {
    expect(findOverviewSection(syntheticOverview, '2')).toMatchObject({ state: 'finalizada' });
  });

  test('renders the complete master hierarchy label', () => {
    expect(consultationLocationLabel({ direction: 'Dirección', department: 'Depto.', section: 'Oficina' }))
      .toBe('Dirección · Depto. · Oficina');
  });

  test.each([
    ['sin_iniciar', 'Sin iniciar'],
    ['en_proceso', 'En proceso'],
    ['finalizada', 'Finalizada'],
  ])('maps section state %s without inferring closure from metrics', (state, label) => {
    expect(consultationSectionState(state)).toBe(label);
  });

  test.each([
    [undefined, 'pending', 'Pendiente'],
    ['verificado', 'conforming', 'Conforme'],
    ['dato_distinto', 'incident', 'Incidencia'],
    ['no_ubicado', 'not-found', 'No encontrado'],
    ['otra_ubicacion', 'other-location', 'Otra ubicación'],
    ['desconocido', 'other', 'Otro'],
  ])('maps asset status %s to a consultation-only presentation', (status, key, label) => {
    expect(consultationAssetStatus(status)).toEqual({ key, label });
  });

  test('shows every master asset as pending in a section without a session', () => {
    const rows = buildConsultationRows([{ id: 1 }, { id: 2 }], [], { state: 'sin_iniciar' });
    expect(rows.map(({ consultationStatus }) => consultationStatus)).toEqual(['pending', 'pending']);
  });

  test('combines open-session observations without changing asset input', () => {
    const asset = { id: 1, assetCode: 'SYN-001' };
    const rows = buildConsultationRows([asset], [{ assetId: 1, status: 'dato_distinto' }], { state: 'en_proceso' });
    expect(rows[0]).toMatchObject({ consultationStatus: 'incident', sectionState: 'en_proceso' });
    expect(asset).toEqual({ id: 1, assetCode: 'SYN-001' });
  });

  test.each([
    ['pending', ['pending']],
    ['reviewed', ['conforming', 'incident']],
    ['incidents', ['incident']],
  ])('filters %s assets independently', (filter, expected) => {
    const rows = ['pending', 'conforming', 'incident'].map((consultationStatus) => ({ consultationStatus }));
    expect(filterConsultationRows(rows, { filter }).map(({ consultationStatus }) => consultationStatus)).toEqual(expected);
  });

  test.each([
    ['romeral', 'Municipalidad de Romeral'],
    ['sn-009', 'SN-009'],
    ['impresora', 'Impresora térmica'],
  ])('normalizes searchable text %s', (query, value) => {
    expect(normalizeConsultationText(value)).toContain(normalizeConsultationText(query));
  });
});

describe('inventory consultation GET API integrity', () => {
  let database;
  let app;
  let evidenceRoot;
  let openLocationId;
  let closedLocationId;
  let untouchedLocationId;
  let openSessionId;

  function insertLocation(code, section) {
    return database.prepare(`
      INSERT INTO locations (location_code, name, direction, department, section)
      VALUES (?, ?, 'Municipalidad de Romeral', 'Departamento sintético', ?)
      RETURNING id
    `).get(code, `Ubicación ${code}`, section).id;
  }

  function insertAsset(code, locationId, suffix) {
    return database.prepare(`
      INSERT INTO assets (
        asset_code, inventory_import_id, location_id, name, description,
        scanner_code, serial_number
      ) VALUES (?, 1, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(
      code,
      locationId,
      `Impresora sintética ${suffix}`,
      `Descripción exclusiva ${suffix}`,
      `SCAN-${suffix}`,
      `SERIE-${suffix}`,
    ).id;
  }

  function databaseCounters() {
    return {
      sessions: database.prepare('SELECT COUNT(*) AS count FROM inventory_sessions').get().count,
      observations: database.prepare('SELECT COUNT(*) AS count FROM observations').get().count,
      audit: database.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
    };
  }

  beforeEach(async () => {
    evidenceRoot = mkdtempSync(join(tmpdir(), 'inventory-consultation-synthetic-'));
    database = openDatabase(':memory:');
    database.prepare(`
      INSERT INTO inventory_imports (
        id, import_code, source_name, source_checksum, sheet_name, row_count
      ) VALUES (1, 'consultation-synthetic', 'synthetic.xlsx', 'synthetic-checksum', 'BD_SQL', 3)
    `).run();
    openLocationId = insertLocation('OPEN', 'Alcaldía activa');
    closedLocationId = insertLocation('CLOSED', 'Archivo finalizado');
    untouchedLocationId = insertLocation('UNTOUCHED', 'Oficina sin iniciar');
    const openAssetId = insertAsset('SYN-ACTIVE-001', openLocationId, 'ACTIVA');
    const closedAssetId = insertAsset('SYN-CLOSED-001', closedLocationId, 'CERRADA');
    insertAsset('SYN-UNTOUCHED-001', untouchedLocationId, 'CONSULTA');
    app = createApp({ database, evidenceRoot });

    openSessionId = (await request(app).post('/api/sessions').send({ locationId: openLocationId }).expect(201)).body.session.id;
    await request(app).post(`/api/sessions/${openSessionId}/observations`)
      .send({ assetId: openAssetId, status: 'verificado', locationId: openLocationId })
      .expect(201);
    const closedSessionId = (await request(app).post('/api/sessions').send({ locationId: closedLocationId }).expect(201)).body.session.id;
    await request(app).post(`/api/sessions/${closedSessionId}/observations`)
      .send({ assetId: closedAssetId, status: 'verificado', locationId: closedLocationId })
      .expect(201);
    await request(app).post(`/api/sessions/${closedSessionId}/close`).send({
      confirm: true,
      statement: 'field-review-complete',
      operatorCode: 'TEST-SINTETICO',
      deviceCode: 'NOTEBOOK-SINTETICO',
    }).expect(200);
  });

  afterEach(() => {
    database.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  test('returns the hierarchy through GET without database writes', async () => {
    const before = databaseCounters();
    const response = await request(app).get('/api/locations').expect(200);
    expect(response.body.locations).toHaveLength(3);
    expect(databaseCounters()).toEqual(before);
  });

  test('returns a different section master through GET without changing active session', async () => {
    const before = databaseCounters();
    const activeBefore = await request(app).get(`/api/sessions/${openSessionId}/summary`).expect(200);
    const response = await request(app).get(`/api/assets?locationId=${untouchedLocationId}`).expect(200);
    const activeAfter = await request(app).get(`/api/sessions/${openSessionId}/summary`).expect(200);
    expect(response.body.assets[0]).toMatchObject({ assetCode: 'SYN-UNTOUCHED-001' });
    expect(activeAfter.body.summary).toEqual(activeBefore.body.summary);
    expect(databaseCounters()).toEqual(before);
  });

  test('reports explicit open, closed and not-started section states', async () => {
    const response = await request(app).get('/api/reports/overview').expect(200);
    const sections = flattenOverviewSections(response.body.overview);
    expect(sections.find(({ locationId }) => locationId === openLocationId).state).toBe('en_proceso');
    expect(sections.find(({ locationId }) => locationId === closedLocationId).state).toBe('finalizada');
    expect(sections.find(({ locationId }) => locationId === untouchedLocationId).state).toBe('sin_iniciar');
  });

  test('reads active observations without adding audit events', async () => {
    const before = databaseCounters();
    const response = await request(app).get(`/api/sessions/${openSessionId}/observations`).expect(200);
    expect(response.body.observations).toHaveLength(1);
    expect(databaseCounters()).toEqual(before);
  });

  test.each([
    ['SYN-UNTOUCHED', 'assetCode', 'SYN-UNTOUCHED'],
    ['Impresora sintética CONSULTA', 'name', 'CONSULTA'],
    ['SCAN-CONSULTA', 'scannerCode', 'CONSULTA'],
    ['Descripción exclusiva CONSULTA', 'description', 'CONSULTA'],
    ['SERIE-CONSULTA', 'serialNumber', 'CONSULTA'],
  ])('global GET search finds by %s and remains read-only', async (query, field, expected) => {
    const before = databaseCounters();
    const response = await request(app).get(`/api/assets/search?q=${encodeURIComponent(query)}`).expect(200);
    expect(response.body.assets[0][field]).toContain(expected);
    expect(databaseCounters()).toEqual(before);
  });
});

describe('inventory consultation UI regression contract', () => {
  test('exposes the consultation while an operational workspace may be active', () => {
    expect(notebookHtml).toContain('id="open-inventory-consultation"');
    expect(notebookHtml).toContain('id="inventory-consultation-dialog"');
    expect(notebookHtml).toContain('Sesión operativa actual');
  });

  test('labels the modal as read-only and provides only consultation controls', () => {
    const modal = notebookHtml.slice(
      notebookHtml.indexOf('id="inventory-consultation-dialog"'),
      notebookHtml.indexOf('<script type="module"'),
    );
    expect(modal).toContain('SOLO LECTURA');
    expect(modal).toContain('data-consultation-filter="pending"');
    expect(modal).not.toMatch(/Iniciar sesión|Registrar|Finalizar revisión|Deshacer|Cancelar sesión|Generar enlace/i);
  });

  test('keeps consultation state separate from operational state and storage', () => {
    expect(notebookSource).toContain('const consultation = createConsultationState()');
    const consultationCode = notebookSource.slice(
      notebookSource.indexOf('function setConsultationOptions'),
      notebookSource.indexOf('async function createPairing'),
    );
    expect(consultationCode).not.toMatch(/localStorage|sessionStorage|state\.sessionId\s*=|state\.locationId\s*=/);
  });

  test('uses only GET requests throughout the consultation implementation', () => {
    const consultationCode = notebookSource.slice(
      notebookSource.indexOf('function setConsultationOptions'),
      notebookSource.indexOf('async function createPairing'),
    );
    expect(consultationCode).toContain("api('/api/locations')");
    expect(consultationCode).toContain("api('/api/reports/overview')");
    expect(consultationCode).not.toMatch(/method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/);
  });
});
