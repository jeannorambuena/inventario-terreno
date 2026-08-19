import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { openDatabase } from '../src/database/connection.js';
import { verifyFieldIntegrity } from '../src/field-integrity.js';

const temporaryRoots = [];

function createEvidenceRoot() {
  const root = join(
    tmpdir(),
    `inventario-integrity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  temporaryRoots.push(root);
  return root;
}

function seed(database) {
  const importId = database.prepare(`
    INSERT INTO inventory_imports (
      import_code, source_name, source_checksum, sheet_name, row_count
    ) VALUES (
      'integrity-test', 'synthetic.xlsx', 'checksum', 'BD_SQL', 1
    )
    RETURNING id
  `).get().id;

  const locationId = database.prepare(`
    INSERT INTO locations (
      location_code, name, direction, department, section
    ) VALUES (
      'LOC-INTEGRITY',
      'Ubicacion sintetica',
      'Direccion',
      'Departamento',
      'Seccion'
    )
    RETURNING id
  `).get().id;

  const sessionId = database.prepare(`
    INSERT INTO inventory_sessions (
      session_code, location_id, status_code
    ) VALUES (
      'SESSION-INTEGRITY', ?, 'open'
    )
    RETURNING id
  `).get(locationId).id;

  database.prepare(`
    INSERT INTO open_session_locks (
      location_id, inventory_session_id
    ) VALUES (?, ?)
  `).run(locationId, sessionId);

  database.prepare(`
    INSERT INTO assets (
      asset_code, inventory_import_id, location_id, name
    ) VALUES (
      '001-INTEGRITY', ?, ?, 'Bien sintetico'
    )
  `).run(importId, locationId);

  const provisionalCode = `PROV-S${sessionId}-0001`;

  const observationId = database.prepare(`
    INSERT INTO observations (
      observation_code,
      inventory_session_id,
      provisional_code,
      status_code,
      selected_location_id,
      notes,
      observed_at
    ) VALUES (
      'OBS-INTEGRITY-1',
      ?,
      ?,
      'desconocido',
      ?,
      '[IDENTIFICACION:sin_etiqueta] [SITUACION:bien_no_registrado]',
      '2026-08-18T12:00:00.000Z'
    )
    RETURNING id
  `).get(
    sessionId,
    provisionalCode,
    locationId,
  ).id;

  database.prepare(`
    INSERT INTO observation_details (
      observation_id, details_json
    ) VALUES (?, ?)
  `).run(
    observationId,
    JSON.stringify({
      label: 'sin_etiqueta',
      physicalCondition: 'bueno',
      functionality: 'no_verificable',
      situations: ['bien_no_registrado'],
      physicalPoint: {
        type: 'patio',
        reference: '',
      },
      provisional: {
        description: 'Bien sintetico adicional',
        brand: '',
        model: '',
        serialNumber: '',
        observedCode: '',
        pendingIdentification: false,
      },
    }),
  );

  database.prepare(`
    INSERT INTO session_provisional_sequences (
      inventory_session_id, next_value
    ) VALUES (?, 2)
  `).run(sessionId);

  return {
    locationId,
    sessionId,
    observationId,
  };
}

function addEvidence(database, root, sessionId, observationId) {
  const directory = join(root, `session-${sessionId}`);
  mkdirSync(directory, { recursive: true });

  const contents = Buffer.from('synthetic-image-data');
  const relativePath = `session-${sessionId}/evidence-test.jpg`;
  const absolutePath = join(root, relativePath);

  writeFileSync(absolutePath, contents);

  database.prepare(`
    INSERT INTO evidence_files (
      evidence_code,
      inventory_session_id,
      observation_id,
      evidence_type,
      relative_path,
      mime_type,
      byte_size,
      sha256
    ) VALUES (
      'EVIDENCE-INTEGRITY-1',
      ?,
      ?,
      'bien_completo',
      ?,
      'image/jpeg',
      ?,
      ?
    )
  `).run(
    sessionId,
    observationId,
    relativePath,
    contents.length,
    createHash('sha256').update(contents).digest('hex'),
  );

  return absolutePath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('field operational integrity verifier', () => {
  test('accepts a complete provisional finding with valid evidence', () => {
    const database = openDatabase(':memory:');
    const root = createEvidenceRoot();
    const { sessionId, observationId } = seed(database);

    addEvidence(database, root, sessionId, observationId);

    const report = verifyFieldIntegrity(database, {
      evidenceRoot: root,
    });

    expect(report.status).toBe('PASS');
    expect(report.failures).toBe(0);

    database.close();
  });

  test('detects missing mandatory evidence', () => {
    const database = openDatabase(':memory:');
    const root = createEvidenceRoot();

    seed(database);

    const report = verifyFieldIntegrity(database, {
      evidenceRoot: root,
    });

    expect(report.status).toBe('FAIL');

    expect(
      report.checks.find(
        ({ name }) => name === 'Politica de evidencias obligatorias',
      )?.status,
    ).toBe('FAIL');

    database.close();
  });

  test('detects evidence modified after registration', () => {
    const database = openDatabase(':memory:');
    const root = createEvidenceRoot();
    const { sessionId, observationId } = seed(database);

    const file = addEvidence(
      database,
      root,
      sessionId,
      observationId,
    );

    writeFileSync(
      file,
      Buffer.from('tampered-image-data'),
    );

    const report = verifyFieldIntegrity(database, {
      evidenceRoot: root,
    });

    expect(report.status).toBe('FAIL');

    expect(
      report.checks.find(
        ({ name }) => name === 'Integridad fisica de evidencias',
      )?.status,
    ).toBe('FAIL');

    database.close();
  });
});
