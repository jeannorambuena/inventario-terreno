import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { createApp } from '../src/server.js';

const notebookSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const notebookHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const mobileSource = readFileSync(new URL('../public/mobile.js', import.meta.url), 'utf8');
const mobileHtml = readFileSync(new URL('../public/mobile.html', import.meta.url), 'utf8');

let database;
let app;
let evidenceRoot;
let locationId;
let assetId;

beforeEach(() => {
  evidenceRoot = mkdtempSync(join(tmpdir(), 'inventario-evidence-synthetic-'));
  database = openDatabase(':memory:');
  const importId = database.prepare(`
    INSERT INTO inventory_imports (
      import_code, source_name, source_checksum, sheet_name, row_count
    ) VALUES ('incidence-synthetic-import', 'synthetic.xlsx', 'synthetic-checksum', 'BD_SQL', 1)
    RETURNING id
  `).get().id;
  locationId = database.prepare(`
    INSERT INTO locations (location_code, name, direction, department, section)
    VALUES ('incidence-location', 'Ubicación sintética',
      'Dirección sintética', 'Departamento sintético', 'Sección sintética')
    RETURNING id
  `).get().id;
  assetId = database.prepare(`
    INSERT INTO assets (asset_code, inventory_import_id, location_id, name, scanner_code)
    VALUES ('SYN-000001', ?, ?, 'Bien sintético', 'SYN-SCAN-000001')
    RETURNING id
  `).get(importId, locationId).id;
  app = createApp({ database, evidenceRoot });
});

afterEach(() => {
  database.close();
  rmSync(evidenceRoot, { recursive: true, force: true });
});

async function createSession() {
  const response = await request(app).post('/api/sessions').send({ locationId }).expect(201);
  return response.body.session.id;
}

function incidenceRequest(sessionId) {
  return request(app)
    .post(`/api/sessions/${sessionId}/incidences`)
    .field('assetId', String(assetId))
    .field('status', 'dato_distinto')
    .field('identification', JSON.stringify(['etiqueta_deteriorada', 'datos_no_coinciden']))
    .field('physical', JSON.stringify(['regular']))
    .field('situation', JSON.stringify(['requiere_revision']))
    .field('details', JSON.stringify({
      label: 'deteriorada', physicalCondition: 'regular', functionality: 'operativo',
      situations: ['requiere_revision'],
      physicalPoint: { type: 'sala', reference: 'Sector sintético' },
      discrepancies: [{ field: 'brand', masterValue: 'Marca A', observedValue: 'Marca B' }],
      review: { reason: 'documentacion', detail: 'Revisar antecedente sintético' },
    }));
}

describe('structured incidences', () => {
  test('stores independent categories and optional evidence under a server-generated private name', async () => {
    const sessionId = await createSession();
    const response = await incidenceRequest(sessionId)
      .field('evidenceType', 'etiqueta_patrimonial')
      .attach('evidence', Buffer.from('synthetic image bytes'), {
        filename: '../../nombre-original-secreto.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(response.body.summary).toMatchObject({
      observacionesTotales: 1,
      incidencias: 1,
      problemasEtiqueta: 1,
      datosNoCoincidentes: 1,
      regulares: 1,
      requiereRevision: 1,
      incidenciasConFoto: 1,
    });
    expect(response.body.evidence).toMatchObject({ type: 'etiqueta_patrimonial' });
    expect(response.body.evidence.path).toMatch(new RegExp(`^session-${sessionId}/S0*${sessionId}_`));
    expect(basename(response.body.evidence.path)).not.toContain('nombre-original');
    expect(existsSync(join(evidenceRoot, response.body.evidence.path))).toBe(true);

    const stored = database.prepare(`
      SELECT notes FROM observations WHERE inventory_session_id = ?
    `).get(sessionId).notes;
    expect(stored).toContain('[IDENTIFICACION:etiqueta_deteriorada]');
    expect(stored).toContain('[IDENTIFICACION:datos_no_coinciden]');
    expect(stored).toContain('[ESTADO_FISICO:regular]');
    expect(stored).toContain('[SITUACION:requiere_revision]');
    expect(stored).toContain('[EVIDENCIA_TIPO:etiqueta_patrimonial]');
    expect(stored).toContain(`[EVIDENCIA_ARCHIVO:${response.body.evidence.path}]`);
    expect(stored).not.toContain('nombre-original-secreto');
  });

  test('requires structured categories and the definitive unknown-master classification', async () => {
    const sessionId = await createSession();
    await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('provisionalCode', 'SYN-PROVISIONAL-001')
      .field('status', 'desconocido')
      .field('identification', '[]')
      .field('physical', '[]')
      .field('situation', '[]')
      .expect(400);

    const accepted = await request(app).post(`/api/sessions/${sessionId}/incidences`)
      .field('provisionalCode', 'SYN-PROVISIONAL-001')
      .field('status', 'desconocido')
      .field('identification', '[]')
      .field('physical', '[]')
      .field('situation', JSON.stringify(['bien_no_registrado']))
      .field('details', JSON.stringify({
        situations: ['bien_no_registrado'],
        physicalPoint: { type: 'bodega', reference: '' },
        provisional: { description: 'Equipo sintético no registrado', observedCode: 'VISIBLE-SYN-01' },
      }))
      .expect(201);
    expect(accepted.body.observation.provisionalCode).toMatch(new RegExp(`^PROV-S${sessionId}-\\d{4}$`));
    expect(accepted.body.summary).toMatchObject({
      hallazgosProvisionales: 1,
      noRegistrados: 1,
    });
  });

  test('does not create an evidence file when the database rejects a duplicate incidence', async () => {
    const sessionId = await createSession();
    await incidenceRequest(sessionId).expect(201);
    const rejected = await incidenceRequest(sessionId)
      .field('evidenceType', 'bien_completo')
      .attach('evidence', Buffer.from('synthetic image bytes'), {
        filename: 'synthetic.jpg',
        contentType: 'image/jpeg',
      })
      .expect(409);
    expect(rejected.body.error).toContain('ya fue observado');
    expect(existsSync(join(evidenceRoot, `session-${sessionId}`))).toBe(true);
    expect(readdirSync(join(evidenceRoot, `session-${sessionId}`))).toHaveLength(0);
    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM observations WHERE inventory_session_id = ?
    `).get(sessionId).count;
    expect(count).toBe(1);
  });

  test('accepts a mobile incidence only with a valid pairing token', async () => {
    const sessionId = await createSession();
    const pairing = await request(app).post(`/api/sessions/${sessionId}/pair`).expect(201);
    const token = pairing.body.pairing.token;

    await request(app).post(`/api/sessions/${sessionId}/mobile-incidences`)
      .field('assetId', String(assetId))
      .field('status', 'dato_distinto')
      .field('identification', JSON.stringify(['pendiente_identificar']))
      .field('physical', '[]')
      .field('situation', '[]')
      .field('details', JSON.stringify({
        discrepancies: [{ field: 'serialNumber', masterValue: 'SERIE-A', observedValue: 'SERIE-B' }],
        physicalPoint: { type: 'sala', reference: '' },
      }))
      .expect(401);

    const accepted = await request(app).post(`/api/sessions/${sessionId}/mobile-incidences`)
      .set('Authorization', `Bearer ${token}`)
      .field('assetId', String(assetId))
      .field('status', 'dato_distinto')
      .field('identification', JSON.stringify(['pendiente_identificar']))
      .field('physical', '[]')
      .field('situation', '[]')
      .field('details', JSON.stringify({
        discrepancies: [{ field: 'serialNumber', masterValue: 'SERIE-A', observedValue: 'SERIE-B' }],
        physicalPoint: { type: 'sala', reference: '' },
      }))
      .expect(201);
    expect(accepted.body.summary).toMatchObject({ pendientesIdentificar: 1 });
  });

  test('opens visibly, cancels without an API write and has no free-text operational note', () => {
    for (const html of [notebookHtml, mobileHtml]) {
      const form = html.slice(html.indexOf('id="observation-form"'), html.indexOf('</form>', html.indexOf('id="observation-form"')));
      expect(form).not.toContain('<textarea');
      expect(form).toContain('id="cancel-incidence"');
      expect(form).toContain('id="evidence-file"');
    }
    for (const source of [notebookSource, mobileSource]) {
      const cancelHandler = source.slice(
        source.indexOf("elements.cancelIncidence.addEventListener('click'"),
        source.indexOf("elements.addEvidence.addEventListener('click'"),
      );
      expect(cancelHandler).toContain('resetEntryFlow()');
      expect(cancelHandler).not.toContain('await api(');
      expect(source).toContain('scrollIntoView');
      expect(source).toContain("value=\"bien_no_registrado\"");
    }
  });
});
