import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  getFieldEvidencePolicy,
  validateFieldRequirements,
} from '../public/field-rules.js';

export const fieldCatalog = Object.freeze({
  label: Object.freeze(['correcta', 'deteriorada', 'ilegible', 'sin_etiqueta', 'posible_duplicada']),
  physicalCondition: Object.freeze(['bueno', 'regular', 'malo', 'incompleto']),
  functionality: Object.freeze(['operativo', 'operativo_con_falla', 'no_operativo', 'no_verificable']),
  situations: Object.freeze([
    'otra_ubicacion', 'en_reparacion', 'prestamo_informado', 'traslado_no_regularizado',
    'bien_tercero', 'bien_no_registrado', 'requiere_revision',
  ]),
  physicalPoints: Object.freeze(['puesto', 'sala', 'bodega', 'recepcion', 'pasillo', 'bano', 'patio', 'mueble', 'otro']),
  discrepancyFields: Object.freeze(['description', 'brand', 'model', 'serialNumber', 'assetType', 'otherIdentifier']),
  incompleteParts: Object.freeze(['fuente_cargador', 'cable', 'tapa', 'bandeja', 'accesorio', 'componente', 'otro']),
  reviewReasons: Object.freeze(['identificacion', 'propiedad', 'ubicacion', 'descripcion', 'serie_modelo', 'estado_fisico', 'documentacion', 'otro']),
  evidenceTypes: Object.freeze(['bien_completo', 'etiqueta_patrimonial', 'serie_modelo', 'dano', 'ubicacion']),
  evidenceExceptionReasons: Object.freeze(['riesgo_seguridad', 'restriccion_acceso', 'sin_elemento_visible', 'falla_tecnica']),
  informationBasis: Object.freeze(['informado', 'verificado']),
});

const oldIdentificationMap = Object.freeze({
  etiqueta_deteriorada: 'deteriorada',
  etiqueta_ilegible: 'ilegible',
  sin_etiqueta: 'sin_etiqueta',
  posible_etiqueta_duplicada: 'posible_duplicada',
});

function text(value, maximum = 120) {
  return String(value ?? '').trim().slice(0, maximum);
}

function uniqueAllowed(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 80)))]
    .filter((value) => allowed.includes(value));
}

export function parseDetails(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeFieldDetails(input = {}, legacy = {}) {
  const source = parseDetails(input);
  const legacyIdentification = Array.isArray(legacy.identification) ? legacy.identification : [];
  const legacyPhysical = Array.isArray(legacy.physical) ? legacy.physical : [];
  const legacySituations = Array.isArray(legacy.situation) ? legacy.situation : [];
  const discrepancies = (Array.isArray(source.discrepancies) ? source.discrepancies : []).map((item) => ({
    field: text(item?.field, 40),
    masterValue: text(item?.masterValue, 250),
    observedValue: text(item?.observedValue, 250),
    pendingFromEvidence: Boolean(item?.pendingFromEvidence),
  })).filter(({ field }) => fieldCatalog.discrepancyFields.includes(field));
  const details = {
    label: fieldCatalog.label.includes(source.label)
      ? source.label
      : Object.hasOwn(source, 'label')
        ? ''
        : oldIdentificationMap[legacyIdentification.find((value) => oldIdentificationMap[value])] || 'correcta',
    physicalCondition: fieldCatalog.physicalCondition.includes(source.physicalCondition)
      ? source.physicalCondition
      : Object.hasOwn(source, 'physicalCondition')
        ? ''
        : legacyPhysical.includes('incompleto') ? 'incompleto'
          : legacyPhysical.includes('malo') ? 'malo'
            : legacyPhysical.includes('regular') ? 'regular' : 'bueno',
    functionality: fieldCatalog.functionality.includes(source.functionality)
      ? source.functionality
      : Object.hasOwn(source, 'functionality')
        ? ''
        : legacyPhysical.includes('no_operativo') ? 'no_operativo' : 'operativo',
    proposedDisposal: Boolean(source.proposedDisposal || legacyPhysical.includes('propuesta_baja')),
    situations: uniqueAllowed(source.situations?.length ? source.situations : legacySituations, fieldCatalog.situations),
    physicalPoint: {
      type: fieldCatalog.physicalPoints.includes(source.physicalPoint?.type) ? source.physicalPoint.type : '',
      reference: text(source.physicalPoint?.reference, 60),
    },
    provisional: {
      description: text(source.provisional?.description, 160),
      brand: text(source.provisional?.brand, 80),
      model: text(source.provisional?.model, 80),
      serialNumber: text(source.provisional?.serialNumber, 120),
      observedCode: text(source.provisional?.observedCode, 120),
      pendingIdentification: Boolean(source.provisional?.pendingIdentification || legacyIdentification.includes('pendiente_identificar')),
    },
    discrepancies,
    discrepancyIndicated: Boolean(source.discrepancyIndicated || legacyIdentification.includes('datos_no_coinciden') || legacyIdentification.includes('caracteristicas_no_coinciden')),
    incomplete: {
      parts: uniqueAllowed(source.incomplete?.parts, fieldCatalog.incompleteParts),
      other: text(source.incomplete?.other, 80),
    },
    review: {
      reason: fieldCatalog.reviewReasons.includes(source.review?.reason) ? source.review.reason : '',
      detail: text(source.review?.detail, 120),
    },
    custody: {
      destination: text(source.custody?.destination, 120),
      reference: text(source.custody?.reference, 100),
      basis: fieldCatalog.informationBasis.includes(source.custody?.basis) ? source.custody.basis : '',
    },
  };
  return details;
}

export function validateFieldDetails(options) {
  return validateFieldRequirements(options);
}

export function getEvidencePolicy(options) {
  return getFieldEvidencePolicy(options);
}

export function generateProvisionalCode(database, sessionId) {
  database.prepare(`
    INSERT OR IGNORE INTO session_provisional_sequences (inventory_session_id, next_value)
    VALUES (?, 1)
  `).run(sessionId);
  const row = database.prepare(`
    SELECT next_value AS nextValue FROM session_provisional_sequences WHERE inventory_session_id = ?
  `).get(sessionId);
  database.prepare(`
    UPDATE session_provisional_sequences SET next_value = next_value + 1 WHERE inventory_session_id = ?
  `).run(sessionId);
  return `PROV-S${sessionId}-${String(row.nextValue).padStart(4, '0')}`;
}

export function writeAudit(database, {
  action, sessionId = null, entityType, entityCode, entityId = null,
  operatorCode = '', deviceCode = '', before = null, after = null, details = null,
}) {
  database.prepare(`
    INSERT INTO audit_log (
      entity_type, entity_code, action_code, details_json,
      inventory_session_id, entity_id, operator_code, device_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entityType, entityCode, action,
    JSON.stringify({ before, after, details }), sessionId, entityId,
    text(operatorCode, 80), text(deviceCode, 80),
  );
}

function secureEvidencePath(evidenceRoot, relativePath) {
  const base = resolve(evidenceRoot);
  const candidate = resolve(base, ...String(relativePath).split('/'));
  return candidate.startsWith(`${base}${sep}`) ? candidate : null;
}

export function inspectEvidenceFile(record, evidenceRoot, { verifyHash = true } = {}) {
  const absolutePath = secureEvidencePath(evidenceRoot, record.relativePath);
  if (!absolutePath || !existsSync(absolutePath)) return { available: false, state: 'missing' };
  const stats = statSync(absolutePath);
  if (!stats.isFile() || stats.size !== record.byteSize) return { available: false, state: 'invalid' };
  if (verifyHash) {
    const checksum = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
    if (checksum !== record.sha256) return { available: false, state: 'invalid' };
  }
  return { available: true, state: 'available' };
}

export function evaluateFieldClosureReadiness(database, sessionId, { evidenceRoot = resolve('evidence'), verifyHashes = true } = {}) {
  const session = database.prepare(`
    SELECT s.id, s.status_code AS status, s.location_id AS locationId
    FROM inventory_sessions s WHERE s.id = ?
  `).get(sessionId);
  if (!session) return null;
  const expected = database.prepare('SELECT COUNT(*) AS count FROM assets WHERE location_id = ?').get(session.locationId).count;
  const observations = database.prepare(`
    SELECT o.id, o.asset_id AS assetId, o.provisional_code AS provisionalCode,
      o.status_code AS status, o.notes, d.details_json AS detailsJson
    FROM observations o
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE o.inventory_session_id = ? AND o.active = 1
  `).all(sessionId);
  const reviewedExpected = new Set(observations.filter(({ assetId, status }) => (
    assetId && ['verificado', 'dato_distinto', 'no_ubicado'].includes(status)
  )).map(({ assetId }) => assetId)).size;
  const blockers = [];
  const warnings = [];
  const addBlocker = (code, message, entity = null) => blockers.push({ code, message, entity });
  const pending = database.prepare(`
    SELECT a.id, a.asset_code AS assetCode, a.name
    FROM assets a
    WHERE a.location_id = ? AND NOT EXISTS (
      SELECT 1 FROM observations o
      WHERE o.inventory_session_id = ? AND o.asset_id = a.id AND o.active = 1
        AND o.status_code IN ('verificado', 'dato_distinto', 'no_ubicado')
    ) ORDER BY a.asset_code
  `).all(session.locationId, sessionId);
  for (const asset of pending) addBlocker('pending_asset', 'Bien esperado pendiente de resultado explícito.', { type: 'asset', id: asset.id, code: asset.assetCode });
  const ambiguities = database.prepare(`
    SELECT id, lookup_code AS lookupCode FROM session_ambiguities
    WHERE inventory_session_id = ? AND resolved_at IS NULL
  `).all(sessionId);
  for (const ambiguity of ambiguities) addBlocker('unresolved_ambiguity', 'Código con coincidencias ambiguas sin resolver.', { type: 'ambiguity', id: ambiguity.id, code: ambiguity.lookupCode });
  let correct = 0;
  let withIncidence = 0;
  let otherLocation = 0;
  let notFound = 0;
  let additional = 0;
  let missingEvidence = 0;
  let pendingIdentification = 0;
  for (const observation of observations) {
    if (observation.status === 'no_ubicado') {
      notFound += 1;
      continue;
    }
    if (observation.status === 'verificado' && !observation.detailsJson && !observation.notes) correct += 1;
    else withIncidence += 1;
    if (observation.status === 'otra_ubicacion') otherLocation += 1;
    if (!observation.assetId) additional += 1;
    if (observation.status === 'verificado' && !observation.detailsJson && !observation.notes) continue;
    const details = normalizeFieldDetails(observation.detailsJson || {});
    const validation = validateFieldDetails({
      assetId: observation.assetId,
      status: observation.status,
      details,
      isIncidence: true,
    });
    for (const error of validation) addBlocker(error.code, error.message, { type: 'observation', id: observation.id });
    if (details.provisional.pendingIdentification) pendingIdentification += 1;
    const policy = getEvidencePolicy({ assetId: observation.assetId, status: observation.status, details });
    const evidence = database.prepare(`
      SELECT id, evidence_type AS evidenceType, relative_path AS relativePath,
        byte_size AS byteSize, sha256, availability_code AS availabilityCode
      FROM evidence_files WHERE observation_id = ? AND active = 1
    `).all(observation.id);
    const validTypes = new Set();
    for (const record of evidence) {
      const inspected = inspectEvidenceFile(record, evidenceRoot, { verifyHash: verifyHashes });
      if (inspected.available) validTypes.add(record.evidenceType);
      else addBlocker('evidence_unavailable', 'Existe una referencia de evidencia no disponible o alterada.', { type: 'evidence', id: record.id, observationId: observation.id });
    }
    const exceptions = new Set(database.prepare(`
      SELECT evidence_type AS evidenceType FROM evidence_exceptions WHERE observation_id = ?
    `).all(observation.id).map(({ evidenceType }) => evidenceType));
    for (const requiredType of policy.required) {
      if (!validTypes.has(requiredType) && !exceptions.has(requiredType)) {
        missingEvidence += 1;
        addBlocker('required_evidence_missing', `Falta evidencia requerida: ${requiredType}.`, { type: 'observation', id: observation.id, evidenceType: requiredType });
      }
    }
    for (const recommendedType of policy.recommended) {
      if (!validTypes.has(recommendedType)) warnings.push({
        code: 'recommended_evidence_missing',
        message: `Evidencia recomendada pendiente: ${recommendedType}.`,
        entity: { type: 'observation', id: observation.id, evidenceType: recommendedType },
      });
    }
  }
  const metrics = {
    expected,
    reviewedExpected,
    correct,
    withIncidence,
    otherLocation,
    notFound,
    additional,
    pending: Math.max(expected - reviewedExpected, 0),
    pendingIdentification,
    incidences: withIncidence,
    missingEvidence,
    ambiguities: ambiguities.length,
    pendingReviews: observations.filter(({ detailsJson }) => normalizeFieldDetails(detailsJson || {}).situations.includes('requiere_revision')).length,
  };
  return { ready: session.status === 'open' && blockers.length === 0, sessionStatus: session.status, blockers, warnings, metrics };
}
