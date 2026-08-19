import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import {
  getEvidencePolicy,
  inspectEvidenceFile,
  normalizeFieldDetails,
  validateFieldDetails,
} from './field-operations.js';
import { parseStructuredNotes } from './reporting.js';

const allowedEvidenceMimes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function normalizeRelativePath(value) {
  return String(value || '').split(sep).join('/');
}

function walkFiles(root) {
  if (!existsSync(root)) return [];

  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        files.push(normalizeRelativePath(relative(root, absolute)));
      }
    }
  };

  visit(root);
  return files;
}

function exampleIds(rows, limit = 5) {
  return rows.slice(0, limit).map((row) => row.id ?? row.observationId ?? row.inventorySessionId);
}

export function verifyFieldIntegrity(database, {
  evidenceRoot = resolve('evidence'),
  verifyHashes = true,
} = {}) {
  const checks = [];

  const add = (name, status, detail, data = undefined) => {
    checks.push({ name, status, detail, data });
  };

  // 1. Integridad SQLite completa.
  const integrityRows = database.prepare('PRAGMA integrity_check').all();
  const integrityOk =
    integrityRows.length === 1
    && Object.values(integrityRows[0])[0] === 'ok';

  add(
    'SQLite integrity_check',
    integrityOk ? 'PASS' : 'FAIL',
    integrityOk ? 'Base SQLite estructuralmente integra.' : 'SQLite reporto problemas estructurales.',
    integrityOk ? undefined : integrityRows,
  );

  // 2. Foreign keys.
  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
  add(
    'Claves foraneas',
    foreignKeyRows.length === 0 ? 'PASS' : 'FAIL',
    foreignKeyRows.length === 0
      ? 'No existen referencias foraneas rotas.'
      : `${foreignKeyRows.length} referencia(s) foranea(s) rota(s).`,
    foreignKeyRows.slice(0, 10),
  );

  // 3. Fuente maestra.
  const master = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM inventory_imports) AS imports,
      (SELECT COUNT(*) FROM locations) AS locations,
      (SELECT COUNT(*) FROM assets) AS assets
  `).get();

  add(
    'Fuente maestra',
    master.imports > 0 && master.locations > 0 && master.assets > 0 ? 'PASS' : 'FAIL',
    `${master.imports} importacion(es), ${master.locations} ubicacion(es), ${master.assets} bien(es).`,
    master,
  );

  // 4. Sesiones abiertas y locks.
  const openWithoutCorrectLock = database.prepare(`
    SELECT s.id
    FROM inventory_sessions s
    LEFT JOIN open_session_locks l
      ON l.inventory_session_id = s.id
      AND l.location_id = s.location_id
    WHERE s.status_code = 'open'
      AND s.location_id IS NOT NULL
      AND l.inventory_session_id IS NULL
  `).all();

  const invalidLocks = database.prepare(`
    SELECT l.inventory_session_id AS id
    FROM open_session_locks l
    LEFT JOIN inventory_sessions s
      ON s.id = l.inventory_session_id
    WHERE s.id IS NULL
       OR s.status_code <> 'open'
       OR s.location_id <> l.location_id
  `).all();

  const lockIssues = [...openWithoutCorrectLock, ...invalidLocks];

  add(
    'Locks de sesiones abiertas',
    lockIssues.length === 0 ? 'PASS' : 'FAIL',
    lockIssues.length === 0
      ? 'Locks y sesiones abiertas son consistentes.'
      : `${lockIssues.length} inconsistencia(s) de lock.`,
    exampleIds(lockIssues),
  );

  // 5. Identidad de observaciones.
  const identityIssues = database.prepare(`
    SELECT id
    FROM observations
    WHERE active = 1
      AND (
        (asset_id IS NULL AND length(trim(COALESCE(provisional_code, ''))) = 0)
        OR
        (asset_id IS NOT NULL AND provisional_code IS NOT NULL)
      )
  `).all();

  add(
    'Identidad de observaciones',
    identityIssues.length === 0 ? 'PASS' : 'FAIL',
    identityIssues.length === 0
      ? 'Cada observacion activa tiene identidad oficial o provisional, nunca ambas.'
      : `${identityIssues.length} observacion(es) con identidad invalida.`,
    exampleIds(identityIssues),
  );

  // 6. Duplicados activos.
  const duplicateAssets = database.prepare(`
    SELECT MIN(id) AS id, inventory_session_id, asset_id, COUNT(*) AS total
    FROM observations
    WHERE active = 1 AND asset_id IS NOT NULL
    GROUP BY inventory_session_id, asset_id
    HAVING COUNT(*) > 1
  `).all();

  const duplicateProvisionals = database.prepare(`
    SELECT MIN(id) AS id, inventory_session_id, provisional_code, COUNT(*) AS total
    FROM observations
    WHERE active = 1 AND provisional_code IS NOT NULL
    GROUP BY inventory_session_id, provisional_code
    HAVING COUNT(*) > 1
  `).all();

  const duplicates = [...duplicateAssets, ...duplicateProvisionals];

  add(
    'Duplicados activos',
    duplicates.length === 0 ? 'PASS' : 'FAIL',
    duplicates.length === 0
      ? 'No existen bienes ni provisionales activos duplicados dentro de una sesion.'
      : `${duplicates.length} duplicado(s) activo(s).`,
    duplicates.slice(0, 10),
  );

  // 7. Cargar observaciones y detalles.
  const observations = database.prepare(`
    SELECT
      o.id,
      o.inventory_session_id AS sessionId,
      o.asset_id AS assetId,
      o.provisional_code AS provisionalCode,
      o.status_code AS status,
      o.notes,
      d.details_json AS detailsJson
    FROM observations o
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE o.active = 1
    ORDER BY o.id
  `).all();

  const detailProblems = [];
  const normalizedByObservation = new Map();

  for (const observation of observations) {
    let rawDetails = {};

    if (observation.detailsJson) {
      try {
        rawDetails = JSON.parse(observation.detailsJson);
        if (!rawDetails || typeof rawDetails !== 'object' || Array.isArray(rawDetails)) {
          throw new Error('details_json no es objeto');
        }
      } catch {
        detailProblems.push({
          id: observation.id,
          code: 'invalid_details_json',
          message: 'details_json no contiene JSON valido.',
        });
        continue;
      }
    }

    const legacy = parseStructuredNotes(observation.notes);

    const normalized = normalizeFieldDetails(rawDetails, {
      identification: legacy.identification,
      physical: legacy.physical,
      situation: legacy.situation,
    });

    normalizedByObservation.set(observation.id, normalized);

    const validationErrors = validateFieldDetails({
      assetId: observation.assetId,
      status: observation.status,
      details: normalized,
      isIncidence: observation.status !== 'verificado',
    });

    for (const error of validationErrors) {
      detailProblems.push({
        id: observation.id,
        code: error.code,
        field: error.field,
        message: error.message,
      });
    }
  }

  add(
    'Datos obligatorios de terreno',
    detailProblems.length === 0 ? 'PASS' : 'FAIL',
    detailProblems.length === 0
      ? 'Todas las observaciones activas cumplen las reglas estructuradas.'
      : `${detailProblems.length} requisito(s) de terreno incumplido(s).`,
    detailProblems.slice(0, 15),
  );

  // 8. Evidencias registradas.
  const evidenceRows = database.prepare(`
    SELECT
      e.id,
      e.inventory_session_id AS sessionId,
      e.observation_id AS observationId,
      e.evidence_type AS evidenceType,
      e.relative_path AS relativePath,
      e.mime_type AS mimeType,
      e.byte_size AS byteSize,
      e.sha256,
      e.availability_code AS availabilityCode,
      o.inventory_session_id AS observationSessionId
    FROM evidence_files e
    JOIN observations o ON o.id = e.observation_id
    WHERE e.active = 1
    ORDER BY e.id
  `).all();

  const evidenceProblems = [];
  const validEvidenceByObservation = new Map();

  for (const evidence of evidenceRows) {
    if (evidence.sessionId !== evidence.observationSessionId) {
      evidenceProblems.push({
        id: evidence.id,
        observationId: evidence.observationId,
        problem: 'La evidencia pertenece a una sesion distinta de su observacion.',
      });
    }

    if (!allowedEvidenceMimes.has(evidence.mimeType)) {
      evidenceProblems.push({
        id: evidence.id,
        observationId: evidence.observationId,
        problem: `MIME no permitido: ${evidence.mimeType}`,
      });
    }

    if (!Number.isInteger(evidence.byteSize) || evidence.byteSize <= 0) {
      evidenceProblems.push({
        id: evidence.id,
        observationId: evidence.observationId,
        problem: 'Tamano de archivo invalido.',
      });
    }

    if (!/^[a-f0-9]{64}$/i.test(String(evidence.sha256 || ''))) {
      evidenceProblems.push({
        id: evidence.id,
        observationId: evidence.observationId,
        problem: 'SHA-256 invalido.',
      });
    }

    const inspection = inspectEvidenceFile(evidence, evidenceRoot, { verifyHash: verifyHashes });

    if (!inspection.available) {
      evidenceProblems.push({
        id: evidence.id,
        observationId: evidence.observationId,
        problem: `Archivo ${inspection.state}: ${evidence.relativePath}`,
      });
      continue;
    }

    if (evidence.availabilityCode !== 'available') {
      evidenceProblems.push({
        id: evidence.id,
        observationId: evidence.observationId,
        problem: `Archivo existe e integra pero availability_code=${evidence.availabilityCode}.`,
      });
    }

    if (!validEvidenceByObservation.has(evidence.observationId)) {
      validEvidenceByObservation.set(evidence.observationId, new Set());
    }

    validEvidenceByObservation
      .get(evidence.observationId)
      .add(evidence.evidenceType);
  }

  add(
    'Integridad fisica de evidencias',
    evidenceProblems.length === 0 ? 'PASS' : 'FAIL',
    evidenceProblems.length === 0
      ? `${evidenceRows.length} evidencia(s) activa(s) verificadas por ruta, tamano y SHA-256.`
      : `${evidenceProblems.length} problema(s) de evidencia.`,
    evidenceProblems.slice(0, 15),
  );

  // 9. Excepciones autorizadas de evidencia.
  const exceptionRows = database.prepare(`
    SELECT observation_id AS observationId, evidence_type AS evidenceType
    FROM evidence_exceptions
  `).all();

  const exceptionKeys = new Set(
    exceptionRows.map(({ observationId, evidenceType }) => `${observationId}:${evidenceType}`),
  );

  const missingRequiredEvidence = [];

  for (const observation of observations) {
    const details = normalizedByObservation.get(observation.id);
    if (!details) continue;

    const policy = getEvidencePolicy({
      assetId: observation.assetId,
      status: observation.status,
      details,
    });

    const validTypes = validEvidenceByObservation.get(observation.id) || new Set();

    for (const requiredType of policy.required) {
      const hasFile = validTypes.has(requiredType);
      const hasException = exceptionKeys.has(`${observation.id}:${requiredType}`);

      if (!hasFile && !hasException) {
        missingRequiredEvidence.push({
          id: observation.id,
          provisionalCode: observation.provisionalCode,
          evidenceType: requiredType,
        });
      }
    }
  }

  add(
    'Politica de evidencias obligatorias',
    missingRequiredEvidence.length === 0 ? 'PASS' : 'FAIL',
    missingRequiredEvidence.length === 0
      ? 'Todas las evidencias obligatorias existen o tienen excepcion auditada.'
      : `${missingRequiredEvidence.length} evidencia(s) obligatoria(s) faltante(s).`,
    missingRequiredEvidence.slice(0, 15),
  );

  // 10. Archivos no registrados en SQLite.
  const evidenceRootExists = existsSync(evidenceRoot);
  const referencedPaths = new Set(
    database.prepare(`
      SELECT relative_path AS relativePath
      FROM evidence_files
    `).all().map(({ relativePath }) => normalizeRelativePath(relativePath)),
  );

  const physicalFiles = evidenceRootExists ? walkFiles(evidenceRoot) : [];
  const orphanFiles = physicalFiles.filter((file) => !referencedPaths.has(file));

  const totalEvidenceRecords = referencedPaths.size;

  if (!evidenceRootExists && totalEvidenceRecords > 0) {
    add(
      'Archivos huerfanos / raiz evidence',
      'FAIL',
      'La carpeta evidence no existe, pero SQLite contiene registros de evidencia.',
    );
  } else {
    add(
      'Archivos huerfanos / raiz evidence',
      orphanFiles.length === 0 ? 'PASS' : 'WARN',
      orphanFiles.length === 0
        ? 'No se detectaron archivos fisicos sin referencia en SQLite.'
        : `${orphanFiles.length} archivo(s) fisico(s) no referenciado(s) en SQLite.`,
      orphanFiles.slice(0, 15),
    );
  }

  // 11. Secuencias provisionales.
  const provisionalRows = database.prepare(`
    SELECT id, inventory_session_id AS sessionId, provisional_code AS provisionalCode
    FROM observations
    WHERE provisional_code IS NOT NULL
    ORDER BY inventory_session_id, id
  `).all();

  const maxBySession = new Map();
  const provisionalSequenceProblems = [];

  for (const row of provisionalRows) {
    const match = /^PROV-S(\d+)-(\d+)$/.exec(row.provisionalCode);

    if (!match) continue;

    const embeddedSessionId = Number(match[1]);
    const number = Number(match[2]);

    if (embeddedSessionId !== row.sessionId) {
      provisionalSequenceProblems.push({
        id: row.id,
        problem: `Codigo ${row.provisionalCode} no corresponde a sesion ${row.sessionId}.`,
      });
      continue;
    }

    maxBySession.set(
      row.sessionId,
      Math.max(maxBySession.get(row.sessionId) || 0, number),
    );
  }

  const sequenceRows = database.prepare(`
    SELECT inventory_session_id AS sessionId, next_value AS nextValue
    FROM session_provisional_sequences
  `).all();

  const sequenceMap = new Map(
    sequenceRows.map(({ sessionId, nextValue }) => [sessionId, nextValue]),
  );

  for (const [sessionId, maximum] of maxBySession) {
    const nextValue = sequenceMap.get(sessionId);

    if (!Number.isInteger(nextValue) || nextValue <= maximum) {
      provisionalSequenceProblems.push({
        inventorySessionId: sessionId,
        problem: `Secuencia invalida: max=${maximum}, next=${nextValue ?? 'ausente'}.`,
      });
    }
  }

  add(
    'Secuencias provisionales',
    provisionalSequenceProblems.length === 0 ? 'PASS' : 'FAIL',
    provisionalSequenceProblems.length === 0
      ? 'Codigos PROV-S y secuencias son consistentes.'
      : `${provisionalSequenceProblems.length} problema(s) de secuencia provisional.`,
    provisionalSequenceProblems.slice(0, 15),
  );

  // 12. JSON de auditoria.
  const auditRows = database.prepare(`
    SELECT id, details_json AS detailsJson
    FROM audit_log
    WHERE details_json IS NOT NULL
      AND length(trim(details_json)) > 0
  `).all();

  const invalidAuditJson = [];

  for (const row of auditRows) {
    try {
      JSON.parse(row.detailsJson);
    } catch {
      invalidAuditJson.push({ id: row.id });
    }
  }

  add(
    'Auditoria estructurada',
    invalidAuditJson.length === 0 ? 'PASS' : 'FAIL',
    invalidAuditJson.length === 0
      ? `${auditRows.length} registro(s) de auditoria con JSON valido.`
      : `${invalidAuditJson.length} registro(s) de auditoria con JSON invalido.`,
    invalidAuditJson.slice(0, 10),
  );

  const failures = checks.filter(({ status }) => status === 'FAIL').length;
  const warnings = checks.filter(({ status }) => status === 'WARN').length;

  return {
    status: failures === 0 ? 'PASS' : 'FAIL',
    failures,
    warnings,
    checkedAt: new Date().toISOString(),
    checks,
    totals: {
      observations: observations.length,
      activeEvidence: evidenceRows.length,
      evidenceExceptions: exceptionRows.length,
      physicalEvidenceFiles: physicalFiles.length,
    },
  };
}
