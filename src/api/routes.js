import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { z } from 'zod';

import { createLookupCodeVariants } from '../../public/code-normalization.js';
import { incidenceCatalog, serializeIncidence } from '../../public/incidence.js';
import {
  actionableFilters,
  buildAlerts,
  describeIncidence,
  filterIncidences,
  groupRegularization,
  parseStructuredNotes,
} from '../reporting.js';
import {
  evaluateFieldClosureReadiness,
  fieldCatalog,
  generateProvisionalCode,
  getEvidencePolicy,
  inspectEvidenceFile,
  normalizeFieldDetails,
  parseDetails,
  validateFieldDetails,
  writeAudit,
} from '../field-operations.js';

const observationStatuses = [
  'verificado',
  'otra_ubicacion',
  'no_ubicado',
  'desconocido',
  'dato_distinto',
];
const shortIdentitySchema = z.string().trim().max(80).default('');

const locationIdSchema = z.coerce.number().int().positive();
const sessionIdSchema = z.coerce.number().int().positive();

const sessionSchema = z.object({
  locationId: locationIdSchema,
  operatorCode: z.string().trim().min(1).max(80).default('OPERADOR'),
  deviceCode: z.string().trim().min(1).max(80).default('NOTEBOOK'),
});

const cancellationSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  confirm: z.literal(true),
});

const undoLastObservationSchema = z.object({
  observationCode: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(1000),
  confirm: z.literal(true),
  operatorCode: z.string().trim().max(80).default('OPERADOR'),
  deviceCode: z.string().trim().max(80).default('NOTEBOOK'),
});

const notFoundSchema = z.object({
  assetId: z.coerce.number().int().positive(),
  confirm: z.literal(true),
  operatorCode: z.string().trim().max(80).default(''),
  deviceCode: z.string().trim().max(80).default('NOTEBOOK'),
});

const correctionSchema = z.object({
  expectedObservationCode: z.string().trim().min(1).max(200),
  action: z.enum(['correct', 'annul']),
  reasonCode: z.enum(['error_clasificacion', 'error_dato', 'error_ubicacion', 'registro_equivocado', 'evidencia_incorrecta', 'otro']),
  operatorCode: z.string().trim().min(1).max(80),
  deviceCode: z.string().trim().min(1).max(80),
  status: z.enum(observationStatuses).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const evidenceExceptionSchema = z.object({
  evidenceType: z.enum(fieldCatalog.evidenceTypes),
  reasonCode: z.enum(fieldCatalog.evidenceExceptionReasons),
  confirm: z.literal(true),
  operatorCode: z.string().trim().min(1).max(80),
  deviceCode: z.string().trim().min(1).max(80),
});

const closeSchema = z.object({
  confirm: z.literal(true),
  statement: z.literal('field-review-complete'),
  operatorCode: z.string().trim().min(1).max(80),
  deviceCode: z.string().trim().min(1).max(80),
});

const incidenceRequestSchema = z.object({
  assetId: z.number().int().positive().nullable().optional(),
  provisionalCode: z.string().trim().max(200).nullable().optional(),
  status: z.enum(observationStatuses),
  identification: z.array(z.enum(incidenceCatalog.identification)).default([]),
  physical: z.array(z.enum(incidenceCatalog.physical)).default([]),
  situation: z.array(z.enum(incidenceCatalog.situation)).default([]),
  evidenceType: z.enum(incidenceCatalog.evidence).optional(),
  details: z.record(z.string(), z.unknown()).default({}),
  operatorCode: z.string().trim().max(80).default(''),
  deviceCode: z.string().trim().max(80).default(''),
}).superRefine((data, context) => {
  if (data.assetId && data.provisionalCode) {
    context.addIssue({ code: 'custom', message: 'No combine assetId y provisionalCode.' });
  }
  if (data.identification.length + data.physical.length + data.situation.length === 0) {
    context.addIssue({ code: 'custom', message: 'Seleccione al menos una categoría de incidencia.' });
  }
  if (data.status === 'otra_ubicacion' && !data.situation.includes('otra_ubicacion')) {
    context.addIssue({ code: 'custom', path: ['situation'], message: 'Falta la categoría otra ubicación.' });
  }
  if (data.status === 'desconocido' && !data.situation.includes('bien_no_registrado')) {
    context.addIssue({ code: 'custom', path: ['situation'], message: 'Falta la categoría bien no registrado.' });
  }
  const labelStates = data.identification.filter((value) => [
    'etiqueta_deteriorada', 'etiqueta_ilegible', 'sin_etiqueta', 'posible_etiqueta_duplicada',
  ].includes(value));
  if (labelStates.length > 1) {
    context.addIssue({ code: 'custom', path: ['identification'], message: 'Seleccione un solo estado principal de etiqueta.' });
  }
  const physicalStates = data.physical.filter((value) => ['regular', 'malo', 'incompleto'].includes(value));
  if (physicalStates.length > 1) {
    context.addIssue({ code: 'custom', path: ['physical'], message: 'Seleccione una sola conservación física.' });
  }
});

const evidenceMimeExtensions = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

const mobileObservationSchema = z.object({
  code: z.string().trim().min(1).max(200),
  assetId: z.number().int().positive().optional(),
  status: z.enum(observationStatuses),
  observation: z.string().trim().max(2000).default(''),
  observedAt: z.iso.datetime().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  deviceCode: z.string().trim().max(80).default('MOVIL'),
});

const observationSchema = z.object({
  assetId: z.number().int().positive().nullable().optional(),
  provisionalCode: z.string().trim().max(200).nullable().optional(),
  status: z.enum(observationStatuses),
  locationId: z.number().int().positive(),
  observation: z.string().trim().max(2000).default(''),
  observedAt: z.iso.datetime().optional(),
  lookupCode: z.string().trim().max(200).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  operatorCode: z.string().trim().max(80).default(''),
  deviceCode: z.string().trim().max(80).default(''),
}).superRefine(({ assetId, provisionalCode, status, observation }, context) => {
  const hasAsset = Boolean(assetId);
  const hasProvisionalCode = Boolean(provisionalCode);

  if (hasAsset && hasProvisionalCode) {
    context.addIssue({
      code: 'custom',
      message: 'No combine assetId y provisionalCode.',
    });
  }

  if (!hasAsset && status !== 'desconocido') {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'Un hallazgo provisional debe registrarse como desconocido.',
    });
  }

  if (status !== 'verificado' && !observation) {
    context.addIssue({
      code: 'custom',
      path: ['observation'],
      message: 'El estado seleccionado requiere una observación.',
    });
  }
});

function assetProjection() {
  return `
    SELECT
      a.id,
      a.asset_code AS assetCode,
      a.scanner_code AS scannerCode,
      a.name,
      a.brand,
      a.serial_number AS serialNumber,
      a.model,
      a.color,
      a.finbaja,
      a.location_id AS locationId,
      l.direction,
      l.department,
      l.section
    FROM assets a
    LEFT JOIN locations l ON l.id = a.location_id
  `;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readPairingToken(request) {
  const authorization = request.get('authorization') ?? '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  return String(request.get('x-pairing-token') ?? '').trim();
}

function getPairing(database, sessionId, request) {
  const token = readPairingToken(request);
  if (!token) return { error: 'Token de emparejamiento requerido.', status: 401 };
  const pairing = database.prepare(`
    SELECT p.id, p.inventory_session_id AS sessionId, p.expires_at AS expiresAt,
      p.revoked_at AS revokedAt, s.status_code AS sessionStatus
    FROM session_pairings p
    JOIN inventory_sessions s ON s.id = p.inventory_session_id
    WHERE p.token_hash = ? AND p.inventory_session_id = ?
  `).get(hashToken(token), sessionId);
  if (!pairing) return { error: 'Token de emparejamiento inválido.', status: 401 };
  if (pairing.sessionStatus === 'closed') {
    return { error: 'La sesión fue cerrada desde el notebook.', status: 410, sessionStatus: 'closed' };
  }
  if (pairing.sessionStatus === 'cancelled') {
    return { error: 'La sesión fue cancelada desde el notebook.', status: 410, sessionStatus: 'cancelled' };
  }
  if (pairing.revokedAt) {
    return { error: 'Token de emparejamiento revocado.', status: 401 };
  }
  if (Date.parse(pairing.expiresAt) <= Date.now()) {
    return { error: 'Token de emparejamiento expirado.', status: 401 };
  }
  return { pairing };
}

function revokeActivePairings(database, sessionId, identity = {}, reason = 'renewed') {
  const active = database.prepare(`
    SELECT id FROM session_pairings
    WHERE inventory_session_id = ? AND revoked_at IS NULL
  `).all(sessionId);
  for (const pairing of active) {
    database.prepare(`
      UPDATE session_pairings
      SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND revoked_at IS NULL
    `).run(pairing.id);
    writeAudit(database, {
      action: 'mobile_pairing_revoked', sessionId, entityType: 'session_pairing',
      entityCode: String(pairing.id), entityId: pairing.id,
      operatorCode: identity.operatorCode || '', deviceCode: identity.deviceCode || 'NOTEBOOK',
      details: { reason },
    });
  }
  return active.length;
}

function findAssetsByCode(database, code) {
  const variants = createLookupCodeVariants(code);
  if (variants.length === 0) return [];
  const placeholders = variants.map(() => '?').join(', ');
  return database.prepare(`
    ${assetProjection()}
    WHERE a.asset_code IN (${placeholders}) OR a.scanner_code IN (${placeholders})
    ORDER BY CASE
      WHEN a.asset_code = ? THEN 0
      WHEN a.scanner_code = ? THEN 1
      ELSE 2
    END, a.asset_code
  `).all(...variants, ...variants, String(code).trim(), String(code).trim());
}

function classifyAsset(asset, sessionLocationId) {
  if (!asset) return 'desconocido';
  return asset.locationId === sessionLocationId ? 'corresponde' : 'otra_ubicacion';
}

function getObservedAssetIds(database, sessionId, assetIds) {
  if (assetIds.length === 0) return new Set();
  const placeholders = assetIds.map(() => '?').join(', ');
  return new Set(database.prepare(`
    SELECT DISTINCT asset_id AS assetId
    FROM observations
    WHERE inventory_session_id = ? AND active = 1 AND asset_id IN (${placeholders})
  `).all(sessionId, ...assetIds).map(({ assetId }) => assetId));
}

function buildLookup(database, sessionId, sessionLocationId, code) {
  const matches = findAssetsByCode(database, code);
  const observedAssetIds = getObservedAssetIds(database, sessionId, matches.map(({ id }) => id));
  const enrichedMatches = matches.map((asset) => ({
    ...asset,
    classification: classifyAsset(asset, sessionLocationId),
    alreadyObserved: observedAssetIds.has(asset.id),
  }));
  if (enrichedMatches.length > 1) {
    database.prepare(`
      INSERT INTO session_ambiguities (inventory_session_id, lookup_code, candidate_count)
      VALUES (?, ?, ?)
      ON CONFLICT(inventory_session_id, lookup_code) DO UPDATE SET
        candidate_count = excluded.candidate_count,
        resolved_at = NULL,
        selected_asset_id = NULL
    `).run(sessionId, String(code).trim(), enrichedMatches.length);
  }
  return {
    code,
    asset: enrichedMatches.length === 1 ? enrichedMatches[0] : null,
    matches: enrichedMatches,
    ambiguous: enrichedMatches.length > 1,
    classification: enrichedMatches.length === 1
      ? enrichedMatches[0].classification
      : enrichedMatches.length === 0 ? 'desconocido' : 'ambiguo',
    alreadyObserved: enrichedMatches.some(({ alreadyObserved }) => alreadyObserved),
  };
}

function saveObservation(database, sessionId, data) {
  const session = database
    .prepare('SELECT status_code AS status, location_id AS locationId FROM inventory_sessions WHERE id = ?')
    .get(sessionId);
  if (!session) return { error: 'Sesión no encontrada.', status: 404 };
  if (session.status !== 'open') return { error: 'La sesión está cerrada.', status: 409 };
  if (!database.prepare('SELECT id FROM locations WHERE id = ?').get(data.locationId)) {
    return { error: 'Ubicación no encontrada.', status: 404 };
  }
  if (data.locationId !== session.locationId) {
    return { error: 'La ubicación seleccionada no corresponde a la sesión.', status: 409 };
  }
  const asset = data.assetId
    ? database.prepare('SELECT id, location_id AS locationId FROM assets WHERE id = ?').get(data.assetId)
    : null;
  if (data.assetId && !asset) return { error: 'Bien no encontrado.', status: 404 };
  if (data.status === 'verificado' && asset?.locationId !== data.locationId) {
    return { error: 'El bien pertenece a otra ubicación; use el estado otra_ubicacion.', status: 409 };
  }

  const provisionalCode = data.assetId ? null : (data.provisionalCode || generateProvisionalCode(database, sessionId));
  const duplicate = data.assetId
    ? database.prepare(`
      SELECT id FROM observations WHERE inventory_session_id = ? AND active = 1 AND asset_id = ? LIMIT 1
    `).get(sessionId, data.assetId)
    : database.prepare(`
      SELECT id FROM observations
      WHERE inventory_session_id = ? AND active = 1 AND asset_id IS NULL AND provisional_code = ?
      LIMIT 1
    `).get(sessionId, provisionalCode);
  if (duplicate) return { error: 'Este bien o código ya fue observado en la sesión.', status: 409 };

  const observedAt = data.observedAt ?? new Date().toISOString();
  const observation = database.prepare(`
    INSERT INTO observations (
      observation_code, inventory_session_id, asset_id, provisional_code,
      status_code, selected_location_id, notes, observed_at, operator_code, device_code,
      version_number, supersedes_observation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, observation_code AS observationCode,
      asset_id AS assetId, provisional_code AS provisionalCode,
      inventory_session_id AS sessionId,
      status_code AS status, selected_location_id AS locationId,
      notes AS observation, observed_at AS observedAt, active,
      operator_code AS operatorCode, device_code AS deviceCode,
      version_number AS versionNumber, supersedes_observation_id AS supersedesObservationId
  `).get(
    randomUUID(),
    sessionId,
    data.assetId ?? null,
    provisionalCode,
    data.status,
    data.locationId,
    data.observation,
    observedAt,
    data.operatorCode || '',
    data.deviceCode || '',
    data.versionNumber || 1,
    data.supersedesObservationId || null,
  );
  const details = data.details ? normalizeFieldDetails(data.details) : null;
  if (details) {
    database.prepare(`
      INSERT INTO observation_details (observation_id, outcome_code, details_json)
      VALUES (?, ?, ?)
    `).run(observation.id, data.status === 'no_ubicado' ? 'not_found' : 'incidence', JSON.stringify(details));
  }
  if (data.lookupCode) {
    database.prepare(`
      UPDATE session_ambiguities
      SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), selected_asset_id = ?
      WHERE inventory_session_id = ? AND lookup_code = ? AND resolved_at IS NULL
    `).run(data.assetId ?? null, sessionId, data.lookupCode);
  }
  writeAudit(database, {
    action: data.status === 'no_ubicado' ? 'observation_not_found_created' : 'observation_created',
    sessionId,
    entityType: 'observation',
    entityCode: observation.observationCode,
    entityId: observation.id,
    operatorCode: data.operatorCode,
    deviceCode: data.deviceCode,
    after: { ...observation, details },
  });
  return { observation };
}

function getLastObservation(database, sessionId) {
  return database.prepare(`
    SELECT
      o.id,
      o.observation_code AS observationCode,
      o.inventory_session_id AS sessionId,
      o.asset_id AS assetId,
      o.provisional_code AS provisionalCode,
      o.status_code AS status,
      o.selected_location_id AS selectedLocationId,
      o.notes,
      o.observed_at AS observedAt,
      o.active,
      o.version_number AS versionNumber,
      d.details_json AS detailsJson,
      o.created_at AS createdAt,
      a.asset_code AS assetCode,
      a.scanner_code AS scannerCode,
      a.name AS assetName
    FROM observations o
    LEFT JOIN assets a ON a.id = o.asset_id
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE o.inventory_session_id = ? AND o.active = 1
    ORDER BY o.observed_at DESC, o.id DESC
    LIMIT 1
  `).get(sessionId) ?? null;
}

function getSessionSummary(database, sessionId) {
  const session = database.prepare(`
    SELECT
      s.id,
      s.session_code AS sessionCode,
      s.location_id AS locationId,
      s.status_code AS status,
      s.started_at AS startedAt,
      s.completed_at AS completedAt,
      s.cancelled_at AS cancelledAt,
      s.cancellation_reason AS cancellationReason,
      s.operator_code AS operatorCode,
      s.device_code AS deviceCode,
      s.closure_confirmed_at AS closureConfirmedAt,
      l.direction,
      l.department,
      l.section
    FROM inventory_sessions s
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE s.id = ?
  `).get(sessionId);

  if (!session) return null;

  const { total } = database
    .prepare('SELECT COUNT(*) AS total FROM assets WHERE location_id = ?')
    .get(session.locationId);
  const metrics = database.prepare(`
    SELECT
      COALESCE(COUNT(o.id), 0) AS observacionesTotales,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code IN ('verificado', 'dato_distinto', 'no_ubicado')
          THEN o.asset_id
      END), 0) AS bienesEsperadosRevisados,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code = 'verificado' THEN o.asset_id
      END), 0) AS bienesConformes,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code = 'dato_distinto' THEN o.asset_id
      END), 0) AS datosDistintos,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code = 'no_ubicado' THEN o.asset_id
      END), 0) AS noUbicados,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code IN ('verificado', 'dato_distinto') THEN o.asset_id
      END), 0) AS encontrados,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.status_code = 'otra_ubicacion' THEN o.asset_id
      END), 0) AS diferenciasUbicacion,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.asset_id IS NULL THEN o.provisional_code
      END), 0) AS hallazgosProvisionales,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.status_code <> 'verificado' OR length(trim(o.notes)) > 0 THEN o.id
      END), 0) AS incidencias,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[IDENTIFICACION:%' THEN o.id
      END), 0) AS problemasIdentificacion,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[ESTADO_FISICO:malo]%' OR o.notes LIKE '%[ESTADO_FISICO:no_operativo]%'
          THEN o.id
      END), 0) AS malosNoOperativos,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[ESTADO_FISICO:propuesta_baja]%' THEN o.id
      END), 0) AS propuestasBaja,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:pendiente_revision]%'
          OR o.notes LIKE '%[SITUACION:requiere_revision]%' THEN o.id
      END), 0) AS pendientesRevision
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[IDENTIFICACION:etiqueta_deteriorada]%'
          OR o.notes LIKE '%[IDENTIFICACION:etiqueta_ilegible]%'
          OR o.notes LIKE '%[IDENTIFICACION:sin_etiqueta]%'
          OR o.notes LIKE '%[IDENTIFICACION:posible_etiqueta_duplicada]%'
          OR o.notes LIKE '%[IDENTIFICACION:posible_duplicacion]%' THEN o.id
      END), 0) AS problemasEtiqueta
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[IDENTIFICACION:sin_etiqueta]%' THEN o.id
      END), 0) AS sinEtiqueta
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[IDENTIFICACION:pendiente_identificar]%' THEN o.id
      END), 0) AS pendientesIdentificar
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[IDENTIFICACION:datos_no_coinciden]%'
          OR o.notes LIKE '%[IDENTIFICACION:caracteristicas_no_coinciden]%' THEN o.id
      END), 0) AS datosNoCoincidentes
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[ESTADO_FISICO:regular]%' THEN o.id
      END), 0) AS regulares
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[ESTADO_FISICO:malo]%' THEN o.id
      END), 0) AS malos
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[ESTADO_FISICO:no_operativo]%' THEN o.id
      END), 0) AS noOperativos
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[ESTADO_FISICO:incompleto]%' THEN o.id
      END), 0) AS incompletos
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:en_reparacion]%' THEN o.id
      END), 0) AS enReparacion
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:prestamo_informado]%' THEN o.id
      END), 0) AS prestamosInformados
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:traslado_no_regularizado]%' THEN o.id
      END), 0) AS trasladosNoRegularizados
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:bien_tercero]%' THEN o.id
      END), 0) AS tercerosNoMunicipales
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:bien_no_registrado]%' OR o.status_code = 'desconocido' THEN o.id
      END), 0) AS noRegistrados
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[SITUACION:requiere_revision]%'
          OR o.notes LIKE '%[SITUACION:pendiente_revision]%' THEN o.id
      END), 0) AS requiereRevision
      ,COALESCE(COUNT(DISTINCT CASE
        WHEN o.notes LIKE '%[EVIDENCIA_ARCHIVO:%' THEN o.id
      END), 0) AS incidenciasConFoto
    FROM observations o
    LEFT JOIN assets a ON a.id = o.asset_id
    WHERE o.inventory_session_id = ? AND o.active = 1
  `).get(
    session.locationId,
    session.locationId,
    session.locationId,
    session.locationId,
    session.locationId,
    sessionId,
  );
  const statusCounts = Object.fromEntries(
    database.prepare(`
      SELECT status_code AS status, COUNT(*) AS count
      FROM observations
      WHERE inventory_session_id = ? AND active = 1
      GROUP BY status_code
      ORDER BY status_code
    `).all(sessionId).map(({ status, count }) => [status, count]),
  );
  metrics.incidenciasConFoto = database.prepare(`
    SELECT COUNT(DISTINCT e.observation_id) AS count
    FROM evidence_files e JOIN observations o ON o.id = e.observation_id
    WHERE e.inventory_session_id = ? AND o.active = 1 AND e.active = 1
  `).get(sessionId).count || metrics.incidenciasConFoto;

  const pendientes = Math.max(total - metrics.bienesEsperadosRevisados, 0);
  const porcentajeRevision = total === 0
    ? 0
    : Math.min(Math.round((metrics.bienesEsperadosRevisados / total) * 100), 100);
  const porcentajeConformidad = total === 0
    ? 0
    : Math.min(Math.round((metrics.bienesConformes / total) * 100), 100);
  const last = getLastObservation(database, sessionId);

  return {
    ...session,
    bienesEsperados: total,
    bienesEsperadosRevisados: metrics.bienesEsperadosRevisados,
    bienesConformes: metrics.bienesConformes,
    datosDistintos: metrics.datosDistintos,
    noUbicados: metrics.noUbicados,
    encontrados: metrics.encontrados,
    diferenciasUbicacion: metrics.diferenciasUbicacion,
    hallazgosProvisionales: metrics.hallazgosProvisionales,
    incidencias: metrics.incidencias,
    problemasIdentificacion: metrics.problemasIdentificacion,
    malosNoOperativos: metrics.malosNoOperativos,
    propuestasBaja: metrics.propuestasBaja,
    pendientesRevision: metrics.pendientesRevision,
    problemasEtiqueta: metrics.problemasEtiqueta,
    sinEtiqueta: metrics.sinEtiqueta,
    pendientesIdentificar: metrics.pendientesIdentificar,
    datosNoCoincidentes: metrics.datosNoCoincidentes,
    regulares: metrics.regulares,
    malos: metrics.malos,
    noOperativos: metrics.noOperativos,
    incompletos: metrics.incompletos,
    enReparacion: metrics.enReparacion,
    prestamosInformados: metrics.prestamosInformados,
    trasladosNoRegularizados: metrics.trasladosNoRegularizados,
    tercerosNoMunicipales: metrics.tercerosNoMunicipales,
    noRegistrados: metrics.noRegistrados,
    requiereRevision: metrics.requiereRevision,
    incidenciasConFoto: metrics.incidenciasConFoto,
    observacionesTotales: metrics.observacionesTotales,
    pendientes,
    porcentajeRevision,
    porcentajeConformidad,
    // Alias temporales para clientes existentes.
    totalAssets: total,
    observations: metrics.observacionesTotales,
    observationCount: metrics.observacionesTotales,
    verifiedExpected: metrics.bienesConformes,
    locationDifferences: metrics.diferenciasUbicacion,
    provisionalFindings: metrics.hallazgosProvisionales,
    observed: metrics.bienesEsperadosRevisados,
    pending: pendientes,
    progressPercent: porcentajeRevision,
    statusCounts,
    lastObservation: last ? {
      observationCode: last.observationCode,
      code: last.assetCode || last.provisionalCode,
      name: last.assetName || 'Bien físico no registrado',
      status: last.status,
      observedAt: last.observedAt,
    } : null,
  };
}

function getSessionIncidences(database, sessionId, evidenceRoot = resolve('evidence')) {
  const rows = database.prepare(`
    SELECT
      o.id,
      o.observation_code AS observationCode,
      o.inventory_session_id AS sessionId,
      o.asset_id AS assetId,
      o.provisional_code AS provisionalCode,
      o.status_code AS status,
      o.notes,
      o.observed_at AS observedAt,
      o.version_number AS versionNumber,
      d.details_json AS detailsJson,
      a.asset_code AS assetCode,
      a.name AS assetName,
      registered.direction AS registeredDirection,
      registered.department AS registeredDepartment,
      registered.section AS registeredSection,
      physical.direction AS physicalDirection,
      physical.department AS physicalDepartment,
      physical.section AS physicalSection,
      session_location.direction AS sessionDirection,
      session_location.department AS sessionDepartment,
      session_location.section AS sessionSection
    FROM observations o
    JOIN inventory_sessions s ON s.id = o.inventory_session_id
    LEFT JOIN assets a ON a.id = o.asset_id
    LEFT JOIN locations registered ON registered.id = a.location_id
    LEFT JOIN locations physical ON physical.id = o.selected_location_id
    LEFT JOIN locations session_location ON session_location.id = s.location_id
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE o.inventory_session_id = ? AND o.active = 1
      AND (o.status_code <> 'verificado' OR o.notes LIKE '%[%')
    ORDER BY o.observed_at DESC, o.id DESC
  `).all(sessionId);
  return rows.map((row) => {
    const evidence = database.prepare(`
      SELECT id, evidence_type AS type, relative_path AS relativePath, mime_type AS mimeType,
        byte_size AS byteSize, sha256, created_at AS createdAt
      FROM evidence_files WHERE observation_id = ? AND active = 1 ORDER BY id
    `).all(row.id).map((record) => {
      const state = inspectEvidenceFile(record, evidenceRoot, { verifyHash: true });
      return {
        id: record.id, type: record.type, byteSize: record.byteSize,
        createdAt: record.createdAt, available: state.available, state: state.state,
        url: `/api/sessions/${sessionId}/observations/${row.id}/evidence/${record.id}`,
      };
    });
    return describeIncidence({ ...row, fieldDetails: parseDetails(row.detailsJson), evidenceRecords: evidence },
      (index) => `/api/sessions/${sessionId}/incidences/${row.id}/evidence/${index}`);
  });
}

function parseRequestedFilters(queryValue) {
  const raw = Array.isArray(queryValue) ? queryValue : [queryValue ?? ''];
  const requested = [...new Set(raw.flatMap((value) => String(value).split(','))
    .map((value) => value.trim()).filter(Boolean))];
  return requested.every((filter) => actionableFilters.includes(filter)) ? requested : null;
}

function createSessionReport(database, sessionId, evidenceRoot = resolve('evidence')) {
  const summary = getSessionSummary(database, sessionId);
  if (!summary) return null;
  const incidences = getSessionIncidences(database, sessionId, evidenceRoot);
  const auditTrail = database.prepare(`
    SELECT action_code AS action, entity_type AS entityType, entity_code AS entityCode,
      entity_id AS entityId, operator_code AS operatorCode, device_code AS deviceCode,
      details_json AS detailsJson, created_at AS createdAt
    FROM audit_log
    WHERE inventory_session_id = ?
      AND action_code IN ('observation_corrected', 'observation_annulled', 'evidence_annulled',
        'undo_last_observation', 'session_closed', 'session_cancelled')
    ORDER BY id
  `).all(sessionId).map((row) => ({
    ...row,
    details: parseDetails(row.detailsJson),
    detailsJson: undefined,
  }));
  return {
    summary,
    incidences,
    auditTrail,
    corrections: auditTrail.filter(({ action }) => action === 'observation_corrected').length,
    annulments: auditTrail.filter(({ action }) => ['observation_annulled', 'evidence_annulled', 'undo_last_observation'].includes(action)).length,
    alerts: buildAlerts(summary, incidences),
    regularization: groupRegularization(incidences),
    generatedAt: new Date().toISOString(),
  };
}

function emptySectionMetrics(expected) {
  return {
    bienesEsperados: expected,
    bienesEsperadosRevisados: 0,
    porcentajeRevision: 0,
    bienesConformes: 0,
    pendientes: expected,
    incidencias: 0,
    diferenciasUbicacion: 0,
    noRegistrados: 0,
    propuestasBaja: 0,
    pendientesRevision: 0,
  };
}

function aggregateMetrics(target, source) {
  for (const field of [
    'bienesEsperados', 'bienesEsperadosRevisados', 'bienesConformes', 'pendientes',
    'incidencias', 'diferenciasUbicacion', 'noRegistrados', 'propuestasBaja',
    'pendientesRevision',
  ]) target[field] += Number(source[field]) || 0;
  target.porcentajeRevision = target.bienesEsperados === 0
    ? 0
    : Math.min(Math.round((target.bienesEsperadosRevisados / target.bienesEsperados) * 100), 100);
}

function getOperationsOverview(database) {
  const locations = database.prepare(`
    SELECT l.id, l.direction, l.department, l.section, COUNT(a.id) AS expected
    FROM locations l
    LEFT JOIN assets a ON a.location_id = l.id
    GROUP BY l.id
    HAVING COUNT(a.id) > 0
    ORDER BY l.direction COLLATE NOCASE, l.department COLLATE NOCASE, l.section COLLATE NOCASE
  `).all();
  const sections = locations.map((location) => {
    const selectedSession = database.prepare(`
      SELECT id, status_code AS status
      FROM inventory_sessions
      WHERE location_id = ? AND status_code IN ('open', 'closed')
      ORDER BY CASE status_code WHEN 'open' THEN 0 ELSE 1 END,
        COALESCE(completed_at, started_at) DESC, id DESC
      LIMIT 1
    `).get(location.id);
    const metrics = selectedSession
      ? getSessionSummary(database, selectedSession.id)
      : emptySectionMetrics(location.expected);
    return {
      locationId: location.id,
      direction: location.direction,
      department: location.department,
      section: location.section,
      sessionId: selectedSession?.id ?? null,
      state: selectedSession?.status === 'open'
        ? 'en_proceso'
        : selectedSession?.status === 'closed' ? 'finalizada' : 'sin_iniciar',
      ...emptySectionMetrics(0),
      ...metrics,
    };
  });

  const overall = { ...emptySectionMetrics(0), sections: sections.length, sinIniciar: 0, enProceso: 0, finalizadas: 0 };
  const directions = new Map();
  for (const section of sections) {
    aggregateMetrics(overall, section);
    if (section.state === 'sin_iniciar') overall.sinIniciar += 1;
    if (section.state === 'en_proceso') overall.enProceso += 1;
    if (section.state === 'finalizada') overall.finalizadas += 1;
    if (!directions.has(section.direction)) {
      directions.set(section.direction, {
        name: section.direction,
        metrics: { ...emptySectionMetrics(0), sections: 0, sinIniciar: 0, enProceso: 0, finalizadas: 0 },
        departments: new Map(),
      });
    }
    const direction = directions.get(section.direction);
    if (!direction.departments.has(section.department)) {
      direction.departments.set(section.department, {
        name: section.department,
        metrics: { ...emptySectionMetrics(0), sections: 0, sinIniciar: 0, enProceso: 0, finalizadas: 0 },
        sections: [],
      });
    }
    const department = direction.departments.get(section.department);
    for (const node of [direction.metrics, department.metrics]) {
      aggregateMetrics(node, section);
      node.sections += 1;
      if (section.state === 'sin_iniciar') node.sinIniciar += 1;
      if (section.state === 'en_proceso') node.enProceso += 1;
      if (section.state === 'finalizada') node.finalizadas += 1;
    }
    department.sections.push(section);
  }
  return {
    generatedAt: new Date().toISOString(),
    overall,
    directions: [...directions.values()].map((direction) => ({
      name: direction.name,
      metrics: direction.metrics,
      departments: [...direction.departments.values()],
    })),
  };
}

function getOpenSessionSummaries(database, locationId) {
  return database.prepare(`
    SELECT id
    FROM inventory_sessions
    WHERE location_id = ? AND status_code = 'open'
    ORDER BY id
  `).all(locationId).map(({ id }) => getSessionSummary(database, id));
}

function parseIncidenceBody(body = {}) {
  const readArray = (name) => {
    try {
      const value = JSON.parse(String(body[name] ?? '[]'));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const assetId = String(body.assetId ?? '').trim();
  const provisionalCode = String(body.provisionalCode ?? '').trim();
  const evidenceType = String(body.evidenceType ?? '').trim();
  const details = parseDetails(body.details);
  return {
    assetId: assetId ? Number(assetId) : null,
    provisionalCode: provisionalCode || null,
    status: String(body.status ?? '').trim(),
    identification: readArray('identification'),
    physical: readArray('physical'),
    situation: readArray('situation'),
    evidenceType: evidenceType || undefined,
    details,
    operatorCode: String(body.operatorCode ?? '').trim(),
    deviceCode: String(body.deviceCode ?? '').trim(),
  };
}

function safeFilePart(value, fallback, maximumLength = 60) {
  const cleaned = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maximumLength);
  return cleaned || fallback;
}

function evidenceTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function prepareEvidenceFile({ evidenceRoot, file, session, code, evidenceType }) {
  if (!file) return null;
  const extension = evidenceMimeExtensions[file.mimetype];
  if (!extension) {
    const error = new Error('La evidencia debe ser una imagen JPEG, PNG o WebP.');
    error.status = 400;
    throw error;
  }
  const sessionPart = `S${String(session.id).padStart(2, '0')}`;
  const locationPart = safeFilePart(
    [session.department, session.section].filter(Boolean).join('-'),
    `UBICACION-${session.locationId}`,
  );
  const codePart = safeFilePart(code, `PROVISIONAL-${randomUUID().slice(0, 8)}`);
  const typePart = safeFilePart(evidenceType, 'EVIDENCIA', 30);
  const filename = `${sessionPart}_${locationPart}_${codePart}_${typePart}_${evidenceTimestamp()}_${randomUUID().slice(0, 8)}.${extension}`;
  const sessionDirectory = `session-${session.id}`;
  const directoryPath = join(evidenceRoot, sessionDirectory);
  const absolutePath = join(directoryPath, filename);
  return {
    absolutePath,
    directoryPath,
    relativePath: `${sessionDirectory}/${filename}`,
    type: evidenceType,
    buffer: file.buffer,
  };
}


function parseAuditPayload(value) {
  if (!value) {
    return {
      before: null,
      after: null,
      details: null,
    };
  }

  try {
    const parsed =
      JSON.parse(String(value));

    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
    ) {
      return {
        before: null,
        after: null,
        details: null,
      };
    }

    return {
      before: parsed.before ?? null,
      after: parsed.after ?? null,
      details: parsed.details ?? null,
    };

  } catch {
    return {
      before: null,
      after: null,
      details: null,
    };
  }
}

function auditObservationIdentity(
  database,
  row,
  payload,
) {
  let observation = null;

  if (
    row.entityType === 'observation'
    && row.entityId
  ) {
    observation = database.prepare(`
      SELECT
        o.id AS observationId,
        o.observation_code AS observationCode,
        o.asset_id AS assetId,
        o.provisional_code AS provisionalCode,
        o.status_code AS observationStatus,
        o.version_number AS versionNumber,
        o.active,
        o.observed_at AS observedAt,
        a.asset_code AS assetCode,
        a.scanner_code AS scannerCode,
        a.name AS assetName,
        d.details_json AS detailsJson
      FROM observations o
      LEFT JOIN assets a
        ON a.id = o.asset_id
      LEFT JOIN observation_details d
        ON d.observation_id = o.id
      WHERE o.id = ?
    `).get(row.entityId) ?? null;
  }

  if (
    !observation
    && row.entityType === 'evidence'
    && row.entityId
  ) {
    observation = database.prepare(`
      SELECT
        o.id AS observationId,
        o.observation_code AS observationCode,
        o.asset_id AS assetId,
        o.provisional_code AS provisionalCode,
        o.status_code AS observationStatus,
        o.version_number AS versionNumber,
        o.active,
        o.observed_at AS observedAt,
        a.asset_code AS assetCode,
        a.scanner_code AS scannerCode,
        a.name AS assetName,
        d.details_json AS detailsJson
      FROM evidence_files e
      JOIN observations o
        ON o.id = e.observation_id
      LEFT JOIN assets a
        ON a.id = o.asset_id
      LEFT JOIN observation_details d
        ON d.observation_id = o.id
      WHERE e.id = ?
    `).get(row.entityId) ?? null;
  }

  if (!observation) {
    const assetId =
      payload?.after?.assetId
      ?? payload?.before?.assetId
      ?? payload?.before?.asset_id
      ?? null;

    if (assetId) {
      const asset = database.prepare(`
        SELECT
          id AS assetId,
          asset_code AS assetCode,
          scanner_code AS scannerCode,
          name AS assetName
        FROM assets
        WHERE id = ?
      `).get(assetId);

      if (asset) {
        return {
          ...asset,
          observationId: null,
          observationCode: null,
          provisionalCode: null,
          observationStatus: null,
          versionNumber: null,
          observationActive: null,
          observedAt: null,
          displayCode:
            asset.assetCode
            || row.entityCode,
        };
      }
    }

    return {
      observationId: null,
      observationCode: null,
      assetId: null,
      assetCode: null,
      scannerCode: null,
      provisionalCode: null,
      assetName: null,
      observationStatus: null,
      versionNumber: null,
      observationActive: null,
      observedAt: null,
      displayCode: row.entityCode,
    };
  }

  const fieldDetails =
    parseDetails(
      observation.detailsJson,
    );

  const assetName =
    observation.assetName
    || fieldDetails.provisional?.description
    || 'Bien fisico no registrado';

  return {
    observationId:
      observation.observationId,

    observationCode:
      observation.observationCode,

    assetId:
      observation.assetId,

    assetCode:
      observation.assetCode,

    scannerCode:
      observation.scannerCode,

    provisionalCode:
      observation.provisionalCode,

    assetName,

    observationStatus:
      observation.observationStatus,

    versionNumber:
      observation.versionNumber,

    observationActive:
      observation.active == null
        ? null
        : Boolean(observation.active),

    observedAt:
      observation.observedAt,

    displayCode:
      observation.assetCode
      || observation.provisionalCode
      || row.entityCode,
  };
}

function serializeAuditEvent(
  database,
  row,
) {
  const payload =
    parseAuditPayload(
      row.detailsJson,
    );

  const identity =
    auditObservationIdentity(
      database,
      row,
      payload,
    );

  return {
    id: row.id,
    sessionId: row.sessionId,
    entityType: row.entityType,
    entityCode: row.entityCode,
    entityId: row.entityId,
    actionCode: row.actionCode,
    operatorCode: row.operatorCode,
    deviceCode: row.deviceCode,
    createdAt: row.createdAt,
    payload,
    ...identity,
  };
}

function getSessionAudit(
  database,
  sessionId,
) {
  const rows = database.prepare(`
    SELECT
      id,
      inventory_session_id AS sessionId,
      entity_type AS entityType,
      entity_code AS entityCode,
      entity_id AS entityId,
      action_code AS actionCode,
      operator_code AS operatorCode,
      device_code AS deviceCode,
      details_json AS detailsJson,
      created_at AS createdAt
    FROM audit_log
    WHERE inventory_session_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(sessionId);

  return rows.map(
    (row) =>
      serializeAuditEvent(
        database,
        row,
      ),
  );
}

function searchTraceability(
  database,
  query,
) {
  const escaped =
    String(query)
      .replace(
        /[\\%_]/g,
        '\\$&',
      );

  const pattern =
    `%${escaped}%`;

  const rows = database.prepare(`
    SELECT
      o.id AS observationId,
      o.inventory_session_id AS sessionId,
      s.location_id AS locationId,
      l.direction,
      l.department,
      l.section,
      o.asset_id AS assetId,
      a.asset_code AS assetCode,
      a.scanner_code AS scannerCode,
      a.name AS assetName,
      o.provisional_code AS provisionalCode,
      o.observation_code AS observationCode,
      o.status_code AS observationStatus,
      o.version_number AS versionNumber,
      o.active,
      o.observed_at AS observedAt,
      d.details_json AS detailsJson
    FROM observations o
    JOIN inventory_sessions s
      ON s.id = o.inventory_session_id
    JOIN locations l
      ON l.id = s.location_id
    LEFT JOIN assets a
      ON a.id = o.asset_id
    LEFT JOIN observation_details d
      ON d.observation_id = o.id
    WHERE
      a.asset_code LIKE ? ESCAPE '\\'
      OR a.scanner_code LIKE ? ESCAPE '\\'
      OR a.name LIKE ? ESCAPE '\\'
      OR o.provisional_code LIKE ? ESCAPE '\\'
      OR o.observation_code LIKE ? ESCAPE '\\'
    ORDER BY
      o.active DESC,
      o.observed_at DESC,
      o.id DESC
    LIMIT 100
  `).all(
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
  );

  const matches = new Map();

  for (const row of rows) {
    const identity =
      row.assetId
        ? `asset:${row.assetId}`
        : `provisional:${row.provisionalCode}`;

    const key =
      `${row.sessionId}:${identity}`;

    const details =
      parseDetails(
        row.detailsJson,
      );

    const assetName =
      row.assetName
      || details.provisional?.description
      || 'Bien fisico no registrado';

    const displayCode =
      row.assetCode
      || row.provisionalCode
      || row.observationCode;

    if (!matches.has(key)) {
      matches.set(
        key,
        {
          sessionId: row.sessionId,
          locationId: row.locationId,
          direction: row.direction,
          department: row.department,
          section: row.section,
          assetId: row.assetId,
          assetCode: row.assetCode,
          scannerCode: row.scannerCode,
          provisionalCode:
            row.provisionalCode,
          displayCode,
          assetName,
          currentStatus:
            row.observationStatus,
          currentVersion:
            row.versionNumber,
          current:
            Boolean(row.active),
          observedAt:
            row.observedAt,
          versions: 1,
        },
      );

      continue;
    }

    const existing =
      matches.get(key);

    existing.versions += 1;

    existing.currentVersion =
      Math.max(
        Number(existing.currentVersion) || 1,
        Number(row.versionNumber) || 1,
      );

    if (row.active) {
      existing.current = true;
      existing.currentStatus =
        row.observationStatus;
      existing.observedAt =
        row.observedAt;
    }
  }

  return [
    ...matches.values(),
  ];
}

function startOrResumeSession(database, locationId, identity = {}) {
  return database.transaction(() => {
    const openSessions = getOpenSessionSummaries(database, locationId);
    if (openSessions.length > 1) return { conflict: openSessions };
    if (openSessions.length === 1) {
      database.prepare(`
        INSERT OR IGNORE INTO open_session_locks (location_id, inventory_session_id)
        VALUES (?, ?)
      `).run(locationId, openSessions[0].id);
      return { session: openSessions[0], resumed: true };
    }

    const created = database.prepare(`
      INSERT INTO inventory_sessions (
        session_code, location_id, status_code, started_at, operator_code, device_code
      ) VALUES (?, ?, 'open', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?)
      RETURNING id
    `).get(randomUUID(), locationId, identity.operatorCode || 'OPERADOR', identity.deviceCode || 'NOTEBOOK');
    database.prepare(`
      INSERT INTO open_session_locks (location_id, inventory_session_id)
      VALUES (?, ?)
    `).run(locationId, created.id);
    writeAudit(database, {
      action: 'session_created', sessionId: created.id, entityType: 'session',
      entityCode: String(created.id), entityId: created.id,
      operatorCode: identity.operatorCode, deviceCode: identity.deviceCode,
      after: { locationId, status: 'open' },
    });
    return { session: getSessionSummary(database, created.id), resumed: false };
  }).immediate();
}

function resolveMobileNetwork(networkInfoProvider) {
  const provided = networkInfoProvider();
  if (Array.isArray(provided)) {
    return {
      source: 'provided-candidates',
      baseUrl: null,
      candidates: provided,
      selected: provided[0] ?? null,
      warning: provided.length === 0 ? 'No hay una interfaz LAN confiable; configure MOBILE_BASE_URL.' : null,
    };
  }
  return provided;
}

function getMobileBaseUrls(networkInfo) {
  if (networkInfo.baseUrl) return [networkInfo.baseUrl];
  return networkInfo.candidates.map(({ address }) => `http://${address}:3180`);
}

export function createApiRouter(database, {
  networkInfoProvider = () => [],
  evidenceRoot = resolve('evidence'),
} = {}) {
  const router = Router();
  const evidenceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (evidenceMimeExtensions[file.mimetype]) return callback(null, true);
      const error = new Error('La evidencia debe ser una imagen JPEG, PNG o WebP.');
      error.status = 400;
      return callback(error);
    },
  });

  const saveStructuredIncidence = ({ mobile = false } = {}) => (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    if (mobile) {
      const authorized = getPairing(database, sessionId.data, request);
      if (authorized.error) {
        return response.status(authorized.status).json({
          error: authorized.error,
          sessionStatus: authorized.sessionStatus,
        });
      }
    }

    const session = getSessionSummary(database, sessionId.data);
    if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
    if (session.status !== 'open') {
      return response.status(409).json({ error: 'Solo una sesión abierta permite registrar incidencias.' });
    }

    const parsed = incidenceRequestSchema.safeParse(parseIncidenceBody(request.body));
    if (!parsed.success) {
      return response.status(400).json({ error: 'Seleccione categorías válidas para la incidencia.' });
    }
    if (parsed.data.status === 'verificado') {
      return response.status(400).json({ error: 'Una incidencia no puede registrarse como verificada.' });
    }
    if (Boolean(request.file) !== Boolean(parsed.data.evidenceType)) {
      return response.status(400).json({ error: 'Seleccione un tipo de evidencia antes de agregar la fotografía.' });
    }

    const asset = parsed.data.assetId
      ? database.prepare('SELECT id, asset_code AS assetCode FROM assets WHERE id = ?').get(parsed.data.assetId)
      : null;
    if (parsed.data.assetId && !asset) return response.status(404).json({ error: 'Bien no encontrado.' });

    const details = normalizeFieldDetails(parsed.data.details, {
      identification: parsed.data.identification,
      physical: parsed.data.physical,
      situation: parsed.data.situation,
    });
    if (!parsed.data.assetId && parsed.data.provisionalCode && !details.provisional.observedCode) {
      details.provisional.observedCode = parsed.data.provisionalCode;
    }
    const detailErrors = validateFieldDetails({
      assetId: parsed.data.assetId,
      status: parsed.data.status,
      details,
      isIncidence: true,
    });
    if (detailErrors.length > 0) {
      return response.status(400).json({
        error: detailErrors[0].message,
        validationErrors: detailErrors,
      });
    }

    const evidence = prepareEvidenceFile({
      evidenceRoot,
      file: request.file,
      session,
      code: asset?.assetCode || parsed.data.provisionalCode || 'PROVISIONAL',
      evidenceType: parsed.data.evidenceType,
    });
    const notes = serializeIncidence({
      identification: parsed.data.identification,
      physical: parsed.data.physical,
      situation: parsed.data.situation,
      evidenceType: evidence?.type,
      evidencePath: evidence?.relativePath,
    });
    const observation = observationSchema.safeParse({
      assetId: parsed.data.assetId,
      provisionalCode: null,
      status: parsed.data.status,
      locationId: session.locationId,
      observation: notes,
      observedAt: new Date().toISOString(),
      details,
      operatorCode: parsed.data.operatorCode || session.operatorCode || '',
      deviceCode: parsed.data.deviceCode || (mobile ? 'MOVIL' : 'NOTEBOOK'),
    });
    if (!observation.success) return response.status(400).json({ error: 'Incidencia inválida.' });

    let evidenceWritten = false;
    try {
      if (evidence) mkdirSync(evidence.directoryPath, { recursive: true });
      const saved = database.transaction(() => {
        const result = saveObservation(database, sessionId.data, observation.data);
        if (result.error) {
          const error = new Error(result.error);
          error.status = result.status;
          throw error;
        }
        if (evidence) {
          writeFileSync(evidence.absolutePath, evidence.buffer, { flag: 'wx' });
          evidenceWritten = true;
          const evidenceRow = database.prepare(`
            INSERT INTO evidence_files (
              evidence_code, inventory_session_id, observation_id, evidence_type,
              relative_path, mime_type, byte_size, sha256
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, evidence_code AS evidenceCode
          `).get(
            randomUUID(), sessionId.data, result.observation.id, evidence.type,
            evidence.relativePath, request.file.mimetype, evidence.buffer.length,
            createHash('sha256').update(evidence.buffer).digest('hex'),
          );
          writeAudit(database, {
            action: 'evidence_created', sessionId: sessionId.data, entityType: 'evidence',
            entityCode: evidenceRow.evidenceCode, entityId: evidenceRow.id,
            operatorCode: parsed.data.operatorCode || session.operatorCode || '',
            deviceCode: parsed.data.deviceCode || (mobile ? 'MOVIL' : 'NOTEBOOK'),
            after: { observationId: result.observation.id, type: evidence.type, byteSize: evidence.buffer.length },
          });
        }
        return result;
      }).immediate();
      return response.status(201).json({
        observation: saved.observation,
        evidence: evidence ? { type: evidence.type, path: evidence.relativePath } : null,
        summary: getSessionSummary(database, sessionId.data),
      });
    } catch (error) {
      if (evidenceWritten && evidence) {
        try { unlinkSync(evidence.absolutePath); } catch { /* El archivo ya no existe. */ }
      }
      if (error.status) return response.status(error.status).json({ error: error.message });
      throw error;
    }
  };

  const addObservationEvidence = ({ mobile = false } = {}) => (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    const evidenceType = String(request.body.evidenceType ?? '').trim();
    if (!sessionId.success || !observationId.success || !fieldCatalog.evidenceTypes.includes(evidenceType)) {
      return response.status(400).json({ error: 'Datos de evidencia inválidos.' });
    }
    if (!request.file) return response.status(400).json({ error: 'Seleccione una fotografía.' });
    if (mobile) {
      const authorized = getPairing(database, sessionId.data, request);
      if (authorized.error) return response.status(authorized.status).json({ error: authorized.error, sessionStatus: authorized.sessionStatus });
    }
    const observation = database.prepare(`
      SELECT o.id, o.observation_code AS observationCode, o.provisional_code AS provisionalCode,
        o.asset_id AS assetId, a.asset_code AS assetCode, s.status_code AS sessionStatus
      FROM observations o
      JOIN inventory_sessions s ON s.id = o.inventory_session_id
      LEFT JOIN assets a ON a.id = o.asset_id
      WHERE o.id = ? AND o.inventory_session_id = ? AND o.active = 1
    `).get(observationId.data, sessionId.data);
    if (!observation) return response.status(404).json({ error: 'Observación activa no encontrada.' });
    if (observation.sessionStatus !== 'open') return response.status(409).json({ error: 'La sesión no está abierta.' });
    const session = getSessionSummary(database, sessionId.data);
    const prepared = prepareEvidenceFile({
      evidenceRoot,
      file: request.file,
      session,
      code: observation.assetCode || observation.provisionalCode,
      evidenceType,
    });
    let written = false;
    try {
      mkdirSync(prepared.directoryPath, { recursive: true });
      writeFileSync(prepared.absolutePath, prepared.buffer, { flag: 'wx' });
      written = true;
      const identity = {
        operatorCode: String(request.body.operatorCode || session.operatorCode || '').trim(),
        deviceCode: String(request.body.deviceCode || (mobile ? 'MOVIL' : 'NOTEBOOK')).trim(),
      };
      const row = database.transaction(() => {
        const evidence = database.prepare(`
          INSERT INTO evidence_files (
            evidence_code, inventory_session_id, observation_id, evidence_type,
            relative_path, mime_type, byte_size, sha256
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id, evidence_code AS evidenceCode, evidence_type AS type,
            byte_size AS byteSize, created_at AS createdAt
        `).get(
          randomUUID(), sessionId.data, observationId.data, evidenceType,
          prepared.relativePath, request.file.mimetype, prepared.buffer.length,
          createHash('sha256').update(prepared.buffer).digest('hex'),
        );
        writeAudit(database, {
          action: 'evidence_created', sessionId: sessionId.data, entityType: 'evidence',
          entityCode: evidence.evidenceCode, entityId: evidence.id, ...identity,
          after: { observationId: observationId.data, type: evidenceType, byteSize: evidence.byteSize },
        });
        return evidence;
      }).immediate();
      return response.status(201).json({ evidence: row });
    } catch (error) {
      if (written) try { unlinkSync(prepared.absolutePath); } catch { /* No quedó un archivo utilizable. */ }
      throw error;
    }
  };

  router.get('/network-info', (_request, response) => {
    const networkInfo = resolveMobileNetwork(networkInfoProvider);
    const baseUrls = getMobileBaseUrls(networkInfo);
    response.json({
      port: 3180,
      source: networkInfo.source,
      addresses: networkInfo.candidates,
      selected: networkInfo.selected,
      warning: networkInfo.warning,
      mobileUrls: baseUrls.map((baseUrl) => `${baseUrl}/mobile`),
    });
  });

  router.get('/locations', (_request, response) => {
    const locations = database.prepare(`
      SELECT id, direction, department, section
      FROM locations
      ORDER BY direction COLLATE NOCASE, department COLLATE NOCASE, section COLLATE NOCASE
    `).all();
    response.json({ locations });
  });

  router.get('/assets', (request, response) => {
    const parsed = locationIdSchema.safeParse(request.query.locationId);
    if (!parsed.success) {
      return response.status(400).json({ error: 'locationId inválido.' });
    }
    const assets = database.prepare(`${assetProjection()} WHERE a.location_id = ? ORDER BY a.asset_code`).all(parsed.data);
    return response.json({ assets });
  });

  router.get('/assets/search', (request, response) => {
    const query = String(request.query.q ?? '').trim();
    if (!query) return response.status(400).json({ error: 'Debe indicar q.' });
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    const assets = database.prepare(`
      ${assetProjection()}
      WHERE a.asset_code LIKE ? ESCAPE '\\'
         OR a.scanner_code LIKE ? ESCAPE '\\'
         OR a.name LIKE ? ESCAPE '\\'
      ORDER BY a.asset_code
      LIMIT 50
    `).all(pattern, pattern, pattern);
    return response.json({ assets });
  });

  router.get('/assets/by-code/:code', (request, response) => {
    const code = String(request.params.code ?? '').trim();
    const requestedSessionId = request.query.sessionId
      ? sessionIdSchema.safeParse(request.query.sessionId)
      : null;
    if (requestedSessionId && !requestedSessionId.success) {
      return response.status(400).json({ error: 'Id de sesión inválido.' });
    }
    if (requestedSessionId?.success) {
      const summary = getSessionSummary(database, requestedSessionId.data);
      if (!summary) return response.status(404).json({ error: 'Sesión no encontrada.' });
      const lookup = buildLookup(database, requestedSessionId.data, summary.locationId, code);
      if (lookup.matches.length === 0) return response.status(404).json({ error: 'Bien no encontrado.', lookup });
      return response.json({ lookup, asset: lookup.asset, matches: lookup.matches, ambiguous: lookup.ambiguous });
    }
    const matches = findAssetsByCode(database, code);
    if (matches.length === 0) return response.status(404).json({ error: 'Bien no encontrado.' });
    return response.json({
      asset: matches.length === 1 ? matches[0] : null,
      matches,
      ambiguous: matches.length > 1,
    });
  });

  router.get('/audit/search', (request, response) => {
    const query =
      String(request.query.q ?? '')
        .trim()
        .slice(0, 120);

    if (query.length < 2) {
      return response.status(400).json({
        error:
          'Indique al menos dos caracteres para buscar trazabilidad.',
      });
    }

    const matches =
      searchTraceability(
        database,
        query,
      );

    return response.json({
      query,
      matches,
    });
  });

  router.post('/sessions', (request, response) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Datos de sesión inválidos.' });
    const location = database.prepare('SELECT id FROM locations WHERE id = ?').get(parsed.data.locationId);
    if (!location) return response.status(404).json({ error: 'Ubicación no encontrada.' });
    try {
      const result = startOrResumeSession(database, parsed.data.locationId, parsed.data);
      if (result.conflict) {
        return response.status(409).json({
          error: 'Hay más de una sesión abierta para esta ubicación. Seleccione explícitamente cuál desea reanudar.',
          sessions: result.conflict,
        });
      }
      return response.status(result.resumed ? 200 : 201).json(result);
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        const openSessions = getOpenSessionSummaries(database, parsed.data.locationId);
        if (openSessions.length === 1) {
          return response.status(200).json({ session: openSessions[0], resumed: true });
        }
        return response.status(409).json({
          error: 'No fue posible determinar una única sesión abierta para esta ubicación.',
          sessions: openSessions,
        });
      }
      throw error;
    }
  });

  router.get('/sessions/open', (request, response) => {
    const parsed = locationIdSchema.safeParse(request.query.locationId);
    if (!parsed.success) return response.status(400).json({ error: 'locationId inválido.' });
    return response.json({ sessions: getOpenSessionSummaries(database, parsed.data) });
  });

  router.post('/sessions/:id/observations', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const parsed = observationSchema.safeParse(request.body);
    if (!sessionId.success || !parsed.success) {
      return response.status(400).json({ error: 'Observación inválida.' });
    }
    const directSession = database.prepare('SELECT status_code AS status FROM inventory_sessions WHERE id = ?').get(sessionId.data);
    if (!directSession) return response.status(404).json({ error: 'Sesión no encontrada.' });
    if (directSession.status !== 'open') return response.status(409).json({ error: 'La sesión está cerrada.' });
    if (!parsed.data.assetId) {
      return response.status(400).json({
        error: 'Los hallazgos adicionales deben registrarse mediante la incidencia estructurada; el servidor generará su identificador provisional.',
      });
    }
    let saved;
    try {
      saved = database.transaction(() => saveObservation(database, sessionId.data, parsed.data)).immediate();
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        return response.status(409).json({ error: 'Este bien ya fue observado en la sesión.' });
      }
      throw error;
    }
    if (saved.error) return response.status(saved.status).json({ error: saved.error });
    return response.status(201).json({ observation: saved.observation });
  });

  router.post('/sessions/:id/assets/:assetId/not-found', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const assetId = sessionIdSchema.safeParse(request.params.assetId);
    const parsed = notFoundSchema.safeParse({ ...request.body, assetId: request.params.assetId });
    if (!sessionId.success || !assetId.success || !parsed.success) {
      return response.status(400).json({ error: 'Confirme el resultado No encontrado en terreno.' });
    }
    const session = getSessionSummary(database, sessionId.data);
    if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
    const asset = database.prepare('SELECT id, location_id AS locationId FROM assets WHERE id = ?').get(assetId.data);
    if (!asset || asset.locationId !== session.locationId) {
      return response.status(409).json({ error: 'El bien no pertenece a los esperados de esta ubicación.' });
    }
    try {
      const saved = database.transaction(() => saveObservation(database, sessionId.data, {
        assetId: assetId.data,
        provisionalCode: null,
        status: 'no_ubicado',
        locationId: session.locationId,
        observation: '',
        operatorCode: parsed.data.operatorCode || session.operatorCode,
        deviceCode: parsed.data.deviceCode,
      })).immediate();
      if (saved.error) return response.status(saved.status).json({ error: saved.error });
      return response.status(201).json({ observation: saved.observation, summary: getSessionSummary(database, sessionId.data) });
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: 'Este bien ya tiene un resultado activo.' });
      throw error;
    }
  });

  router.post(
    '/sessions/:id/incidences',
    evidenceUpload.single('evidence'),
    saveStructuredIncidence(),
  );

  router.post(
    '/sessions/:id/mobile-incidences',
    evidenceUpload.single('evidence'),
    saveStructuredIncidence({ mobile: true }),
  );

  router.post(
    '/sessions/:id/observations/:observationId/evidence',
    evidenceUpload.single('evidence'),
    addObservationEvidence(),
  );

  router.post(
    '/sessions/:id/mobile-observations/:observationId/evidence',
    evidenceUpload.single('evidence'),
    addObservationEvidence({ mobile: true }),
  );

  router.get('/reports/overview', (_request, response) => {
    response.json({ overview: getOperationsOverview(database) });
  });

  router.get('/reports/sessions', (_request, response) => {
    const sessions = database.prepare(`
      SELECT id FROM inventory_sessions
      ORDER BY COALESCE(completed_at, cancelled_at, started_at) DESC, id DESC
    `).all().map(({ id }) => getSessionSummary(database, id));
    response.json({ sessions });
  });

  router.get('/sessions/:id/report', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const report = createSessionReport(database, sessionId.data, evidenceRoot);
    if (!report) return response.status(404).json({ error: 'Sesión no encontrada.' });
    return response.json({ report });
  });

  router.get('/sessions/:id/incidences', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    if (!getSessionSummary(database, sessionId.data)) {
      return response.status(404).json({ error: 'Sesión no encontrada.' });
    }
    const filters = parseRequestedFilters(request.query.filter);
    if (!filters) return response.status(400).json({ error: 'Filtro de incidencia inválido.' });
    const allIncidences = getSessionIncidences(database, sessionId.data, evidenceRoot);
    return response.json({
      incidences: filterIncidences(allIncidences, filters),
      total: allIncidences.length,
      filters,
    });
  });

  router.get('/sessions/:id/incidences/:observationId', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    if (!sessionId.success || !observationId.success) {
      return response.status(400).json({ error: 'Identificador de incidencia inválido.' });
    }
    const incidence = getSessionIncidences(database, sessionId.data, evidenceRoot)
      .find(({ id }) => id === observationId.data);
    if (!incidence) return response.status(404).json({ error: 'Incidencia no encontrada en la sesión.' });
    return response.json({ incidence });
  });

  router.get('/sessions/:id/incidences/:observationId/evidence/:index', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    const evidenceIndex = z.coerce.number().int().min(0).safeParse(request.params.index);
    if (!sessionId.success || !observationId.success || !evidenceIndex.success) {
      return response.status(400).json({ error: 'Identificador de evidencia inválido.' });
    }
    const observation = database.prepare(`
      SELECT notes FROM observations
      WHERE id = ? AND inventory_session_id = ?
    `).get(observationId.data, sessionId.data);
    if (!observation) return response.status(404).json({ error: 'Incidencia no encontrada en la sesión.' });
    const relativePath = parseStructuredNotes(observation.notes).evidencePaths[evidenceIndex.data];
    if (!relativePath) return response.status(404).json({ error: 'Evidencia no encontrada.' });
    const safePattern = new RegExp(`^session-${sessionId.data}/[A-Z0-9][A-Z0-9._-]*\\.(?:jpg|jpeg|png|webp)$`, 'i');
    if (!safePattern.test(relativePath) || relativePath.includes('..') || relativePath.includes('\\')) {
      return response.status(400).json({ error: 'Referencia de evidencia inválida.' });
    }
    const evidenceBase = resolve(evidenceRoot);
    const absolutePath = resolve(evidenceBase, ...relativePath.split('/'));
    if (!absolutePath.startsWith(`${evidenceBase}${sep}`)) {
      return response.status(400).json({ error: 'Referencia de evidencia inválida.' });
    }
    if (!existsSync(evidenceBase) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      return response.status(404).json({ error: 'Archivo de evidencia no disponible.' });
    }
    const realBase = realpathSync(evidenceBase);
    const realEvidencePath = realpathSync(absolutePath);
    if (!realEvidencePath.startsWith(`${realBase}${sep}`)) {
      return response.status(400).json({ error: 'Referencia de evidencia inválida.' });
    }
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    const contentType = mimeTypes[extname(absolutePath).toLowerCase()];
    if (!contentType) return response.status(415).json({ error: 'Formato de evidencia no autorizado.' });
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    return response.sendFile(realEvidencePath);
  });

  router.post('/sessions/:id/observations/undo-last', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const parsed = undoLastObservationSchema.safeParse(request.body);
    if (!sessionId.success || !parsed.success) {
      return response.status(400).json({
        error: 'Deshacer requiere el último registro mostrado, un motivo y confirmación expresa.',
      });
    }

    try {
      const result = database.transaction(() => {
        const session = database.prepare(`
          SELECT id, status_code AS status
          FROM inventory_sessions
          WHERE id = ?
        `).get(sessionId.data);
        if (!session) return { error: 'Sesión no encontrada.', status: 404 };
        if (session.status !== 'open') {
          return { error: 'Solo una sesión abierta permite deshacer registros.', status: 409 };
        }

        const latest = getLastObservation(database, sessionId.data);
        if (!latest) return { error: 'La sesión no tiene registros para deshacer.', status: 409 };
        if (latest.observationCode !== parsed.data.observationCode) {
          return {
            error: 'El último registro cambió en otro dispositivo. Actualice la sesión antes de deshacer.',
            status: 409,
            summary: getSessionSummary(database, sessionId.data),
          };
        }

        writeAudit(database, {
          action: 'undo_last_observation', sessionId: sessionId.data,
          entityType: 'observation', entityCode: latest.observationCode, entityId: latest.id,
          operatorCode: parsed.data.operatorCode, deviceCode: parsed.data.deviceCode,
          before: latest, details: { reason: parsed.data.reason },
        });

        const deletion = database.prepare(`
          UPDATE observations
          SET active = 0, annulled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
            AND observation_code = ?
            AND inventory_session_id = ?
            AND asset_id IS ?
            AND provisional_code IS ?
            AND status_code = ?
            AND selected_location_id IS ?
            AND notes = ?
            AND observed_at = ?
            AND created_at = ?
            AND active = 1
        `).run(
          latest.id,
          latest.observationCode,
          latest.sessionId,
          latest.assetId,
          latest.provisionalCode,
          latest.status,
          latest.selectedLocationId,
          latest.notes,
          latest.observedAt,
          latest.createdAt,
        );
        if (deletion.changes !== 1) {
          const error = new Error('El registro cambió durante la reversión; no se eliminó ninguna observación.');
          error.status = 409;
          throw error;
        }

        return { summary: getSessionSummary(database, sessionId.data) };
      }).immediate();

      if (result.error) return response.status(result.status).json(result);
      return response.json(result);
    } catch (error) {
      if (error.status === 409) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.get('/sessions/:id/audit', (request, response) => {
    const sessionId =
      sessionIdSchema.safeParse(
        request.params.id,
      );

    if (!sessionId.success) {
      return response.status(400).json({
        error: 'Id de sesion invalido.',
      });
    }

    const session =
      getSessionSummary(
        database,
        sessionId.data,
      );

    if (!session) {
      return response.status(404).json({
        error: 'Sesion no encontrada.',
      });
    }

    const audit =
      getSessionAudit(
        database,
        sessionId.data,
      );

    return response.json({
      session: {
        id: session.id,
        status: session.status,
        locationId: session.locationId,
        direction: session.direction,
        department: session.department,
        section: session.section,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        cancelledAt: session.cancelledAt,
      },
      audit,
    });
  });

  router.get('/sessions/:id/observations', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const session = getSessionSummary(database, sessionId.data);
    if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
    const observations = database.prepare(`
      SELECT o.id, o.observation_code AS observationCode, o.asset_id AS assetId,
        o.provisional_code AS provisionalCode, o.status_code AS status,
        o.observed_at AS observedAt, o.version_number AS versionNumber,
        a.asset_code AS assetCode, a.name AS assetName, d.details_json AS detailsJson
      FROM observations o
      LEFT JOIN assets a ON a.id = o.asset_id
      LEFT JOIN observation_details d ON d.observation_id = o.id
      WHERE o.inventory_session_id = ? AND o.active = 1
      ORDER BY o.observed_at DESC, o.id DESC
    `).all(sessionId.data).map((row) => ({ ...row, details: parseDetails(row.detailsJson), detailsJson: undefined }));
    return response.json({ observations });
  });

  router.post('/sessions/:id/observations/:observationId/correct', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    const parsed = correctionSchema.safeParse(request.body);
    if (!sessionId.success || !observationId.success || !parsed.success) {
      return response.status(400).json({ error: 'Corrección inválida; indique motivo, operador y dispositivo.' });
    }
    try {
      const result = database.transaction(() => {
        const session = getSessionSummary(database, sessionId.data);
        if (!session) return { error: 'Sesión no encontrada.', status: 404 };
        if (session.status !== 'open') return { error: 'Sólo se corrigen registros de una sesión abierta.', status: 409 };
        const current = database.prepare(`
          SELECT o.*, d.details_json AS detailsJson
          FROM observations o LEFT JOIN observation_details d ON d.observation_id = o.id
          WHERE o.id = ? AND o.inventory_session_id = ? AND o.active = 1
        `).get(observationId.data, sessionId.data);
        if (!current) return { error: 'La observación activa ya no existe.', status: 409 };
        if (current.observation_code !== parsed.data.expectedObservationCode) {
          return { error: 'El registro cambió; actualice antes de corregir.', status: 409 };
        }
        if (parsed.data.action === 'annul') {
          const changed = database.prepare(`
            UPDATE observations SET active = 0,
              annulled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ? AND active = 1
          `).run(current.id);
          if (changed.changes !== 1) return { error: 'El registro cambió durante la anulación.', status: 409 };
          writeAudit(database, {
            action: 'observation_annulled', sessionId: sessionId.data,
            entityType: 'observation', entityCode: current.observation_code, entityId: current.id,
            operatorCode: parsed.data.operatorCode, deviceCode: parsed.data.deviceCode,
            before: { ...current, details: parseDetails(current.detailsJson) },
            details: { reasonCode: parsed.data.reasonCode },
          });
          return { corrected: false, annulled: true };
        }
        const status = parsed.data.status || current.status_code;
        const details = normalizeFieldDetails(parsed.data.details || parseDetails(current.detailsJson));
        const isIncidence = status !== 'verificado' || Boolean(current.detailsJson) || Boolean(current.notes);
        const errors = validateFieldDetails({ assetId: current.asset_id, status, details, isIncidence });
        if (errors.length) return { error: errors[0].message, status: 400, validationErrors: errors };
        database.prepare(`
          UPDATE observations SET active = 0,
            annulled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND active = 1
        `).run(current.id);
        const saved = saveObservation(database, sessionId.data, {
          assetId: current.asset_id,
          provisionalCode: current.provisional_code,
          status,
          locationId: current.selected_location_id,
          observation: current.notes,
          details: isIncidence ? details : undefined,
          operatorCode: parsed.data.operatorCode,
          deviceCode: parsed.data.deviceCode,
          versionNumber: current.version_number + 1,
          supersedesObservationId: current.id,
        });
        if (saved.error) return saved;
        database.prepare(`
          INSERT INTO evidence_files (
            evidence_code, inventory_session_id, observation_id, evidence_type,
            relative_path, mime_type, byte_size, sha256, availability_code
          )
          SELECT lower(hex(randomblob(16))), inventory_session_id, ?, evidence_type,
            relative_path, mime_type, byte_size, sha256, availability_code
          FROM evidence_files WHERE observation_id = ? AND active = 1
        `).run(saved.observation.id, current.id);
        writeAudit(database, {
          action: 'observation_corrected', sessionId: sessionId.data,
          entityType: 'observation', entityCode: saved.observation.observationCode,
          entityId: saved.observation.id, operatorCode: parsed.data.operatorCode,
          deviceCode: parsed.data.deviceCode,
          before: { ...current, details: parseDetails(current.detailsJson) },
          after: saved.observation, details: { reasonCode: parsed.data.reasonCode },
        });
        return { corrected: true, annulled: false, observation: saved.observation };
      }).immediate();
      if (result.error) return response.status(result.status).json(result);
      return response.json({ ...result, summary: getSessionSummary(database, sessionId.data) });
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: 'La corrección produciría un registro activo duplicado.' });
      throw error;
    }
  });

  router.get('/sessions/:id/observations/:observationId/evidence', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    if (!sessionId.success || !observationId.success) return response.status(400).json({ error: 'Identificador inválido.' });
    const rows = database.prepare(`
      SELECT e.id, e.evidence_code AS evidenceCode, e.evidence_type AS type,
        e.relative_path AS relativePath, e.mime_type AS mimeType,
        e.byte_size AS byteSize, e.sha256, e.created_at AS createdAt
      FROM evidence_files e JOIN observations o ON o.id = e.observation_id
      WHERE e.inventory_session_id = ? AND e.observation_id = ? AND o.active = 1 AND e.active = 1
      ORDER BY e.id
    `).all(sessionId.data, observationId.data).map((record) => {
      const state = inspectEvidenceFile(record, evidenceRoot, { verifyHash: true });
      return {
        id: record.id,
        evidenceCode: record.evidenceCode,
        type: record.type,
        byteSize: record.byteSize,
        createdAt: record.createdAt,
        available: state.available,
        state: state.state,
        url: `/api/sessions/${sessionId.data}/observations/${observationId.data}/evidence/${record.id}`,
      };
    });
    return response.json({ evidence: rows });
  });

  router.post('/sessions/:id/observations/:observationId/evidence-exceptions', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    const parsed = evidenceExceptionSchema.safeParse(request.body);
    if (!sessionId.success || !observationId.success || !parsed.success) {
      return response.status(400).json({ error: 'Excepción de evidencia inválida.' });
    }
    const result = database.transaction(() => {
      const observation = database.prepare(`
        SELECT o.id, o.observation_code AS observationCode, s.status_code AS sessionStatus
        FROM observations o JOIN inventory_sessions s ON s.id = o.inventory_session_id
        WHERE o.id = ? AND o.inventory_session_id = ? AND o.active = 1
      `).get(observationId.data, sessionId.data);
      if (!observation) return { error: 'Observación activa no encontrada.', status: 404 };
      if (observation.sessionStatus !== 'open') return { error: 'La sesión no está abierta.', status: 409 };
      database.prepare(`
        INSERT INTO evidence_exceptions (
          inventory_session_id, observation_id, evidence_type, reason_code,
          operator_code, device_code
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(observation_id, evidence_type) DO UPDATE SET
          reason_code = excluded.reason_code,
          operator_code = excluded.operator_code,
          device_code = excluded.device_code
      `).run(
        sessionId.data, observationId.data, parsed.data.evidenceType, parsed.data.reasonCode,
        parsed.data.operatorCode, parsed.data.deviceCode,
      );
      writeAudit(database, {
        action: 'evidence_exception_created', sessionId: sessionId.data,
        entityType: 'observation', entityCode: observation.observationCode, entityId: observation.id,
        operatorCode: parsed.data.operatorCode, deviceCode: parsed.data.deviceCode,
        details: { evidenceType: parsed.data.evidenceType, reasonCode: parsed.data.reasonCode },
      });
      return { accepted: true };
    }).immediate();
    if (result.error) return response.status(result.status).json(result);
    return response.status(201).json(result);
  });

  router.post('/sessions/:id/observations/:observationId/evidence/:evidenceId/annul', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    const evidenceId = sessionIdSchema.safeParse(request.params.evidenceId);
    const parsed = z.object({
      reasonCode: z.enum(['registro_equivocado', 'evidencia_incorrecta', 'otra_causa']),
      operatorCode: shortIdentitySchema,
      deviceCode: shortIdentitySchema,
    }).safeParse(request.body);
    if (!sessionId.success || !observationId.success || !evidenceId.success || !parsed.success) {
      return response.status(400).json({ error: 'Solicitud de anulación de evidencia inválida.' });
    }
    const result = database.transaction(() => {
      const record = database.prepare(`
        SELECT e.id, e.evidence_code AS evidenceCode, e.evidence_type AS type,
          e.relative_path AS relativePath, e.sha256, s.status_code AS sessionStatus
        FROM evidence_files e
        JOIN observations o ON o.id = e.observation_id
        JOIN inventory_sessions s ON s.id = e.inventory_session_id
        WHERE e.id = ? AND e.inventory_session_id = ? AND e.observation_id = ?
          AND e.active = 1 AND o.active = 1
      `).get(evidenceId.data, sessionId.data, observationId.data);
      if (!record) return { error: 'Evidencia activa no encontrada.', status: 404 };
      if (record.sessionStatus !== 'open') return { error: 'La sesión no está abierta.', status: 409 };
      const changed = database.prepare(`
        UPDATE evidence_files SET active = 0,
          annulled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND active = 1
      `).run(record.id);
      if (changed.changes !== 1) return { error: 'La evidencia cambió; actualice antes de continuar.', status: 409 };
      writeAudit(database, {
        action: 'evidence_annulled', sessionId: sessionId.data, entityType: 'evidence',
        entityCode: record.evidenceCode, entityId: record.id,
        operatorCode: parsed.data.operatorCode, deviceCode: parsed.data.deviceCode,
        before: { type: record.type, relativePath: record.relativePath, sha256: record.sha256, active: true },
        after: { active: false }, details: { reasonCode: parsed.data.reasonCode },
      });
      return { annulled: true };
    }).immediate();
    if (result.error) return response.status(result.status).json(result);
    return response.json(result);
  });

  router.get('/sessions/:id/observations/:observationId/evidence/:evidenceId', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const observationId = sessionIdSchema.safeParse(request.params.observationId);
    const evidenceId = sessionIdSchema.safeParse(request.params.evidenceId);
    if (!sessionId.success || !observationId.success || !evidenceId.success) return response.status(400).json({ error: 'Identificador de evidencia inválido.' });
    const record = database.prepare(`
      SELECT relative_path AS relativePath, mime_type AS mimeType,
        byte_size AS byteSize, sha256
      FROM evidence_files
      WHERE id = ? AND inventory_session_id = ? AND observation_id = ? AND active = 1
    `).get(evidenceId.data, sessionId.data, observationId.data);
    if (!record) return response.status(404).json({ error: 'Evidencia no encontrada.' });
    const state = inspectEvidenceFile(record, evidenceRoot, { verifyHash: true });
    if (!state.available) return response.status(404).json({ error: 'Evidencia no disponible o alterada.', state: state.state });
    const evidenceBase = resolve(evidenceRoot);
    const absolutePath = resolve(evidenceBase, ...record.relativePath.split('/'));
    const realBase = realpathSync(evidenceBase);
    const realEvidencePath = realpathSync(absolutePath);
    if (!realEvidencePath.startsWith(`${realBase}${sep}`)) return response.status(400).json({ error: 'Referencia de evidencia inválida.' });
    response.set({ 'Cache-Control': 'private, no-store', 'Content-Type': record.mimeType, 'X-Content-Type-Options': 'nosniff' });
    return response.sendFile(realEvidencePath);
  });

  router.post('/sessions/:id/pair', async (request, response, next) => {
    try {
      const sessionId = sessionIdSchema.safeParse(request.params.id);
      if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
      const session = database
        .prepare('SELECT status_code AS status, operator_code AS operatorCode FROM inventory_sessions WHERE id = ?')
        .get(sessionId.data);
      if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
      if (session.status !== 'open') return response.status(409).json({ error: 'La sesión está cerrada.' });

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      database.transaction(() => {
        const revoked = revokeActivePairings(database, sessionId.data, {
          operatorCode: session.operatorCode || '', deviceCode: 'NOTEBOOK',
        }, 'renewed');
        const createdPairing = database.prepare(`
          INSERT INTO session_pairings (inventory_session_id, token_hash, expires_at)
          VALUES (?, ?, ?)
          RETURNING id
        `).get(sessionId.data, hashToken(token), expiresAt);
        writeAudit(database, {
          action: revoked ? 'mobile_pairing_renewed' : 'mobile_pairing_created', sessionId: sessionId.data,
          entityType: 'session_pairing', entityCode: String(createdPairing.id), entityId: createdPairing.id,
          operatorCode: session.operatorCode || '', deviceCode: 'NOTEBOOK',
          details: { expiresAt, previousLinksRevoked: revoked },
        });
      }).immediate();

      const networkInfo = resolveMobileNetwork(networkInfoProvider);
      const mobileUrls = getMobileBaseUrls(networkInfo).map((baseUrl) => (
        `${baseUrl}/mobile?sessionId=${sessionId.data}&token=${encodeURIComponent(token)}`
      ));
      if (mobileUrls.length === 0) {
        mobileUrls.push(`http://localhost:3180/mobile?sessionId=${sessionId.data}&token=${encodeURIComponent(token)}`);
      }
      const mobileUrl = mobileUrls[0];
      const qrDataUrl = await QRCode.toDataURL(mobileUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
      return response.status(201).json({
        pairing: { sessionId: sessionId.data, token, expiresAt, mobileUrl, mobileUrls, qrDataUrl },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/sessions/:id/mobile', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const authorized = getPairing(database, sessionId.data, request);
    if (authorized.error) return response.status(authorized.status).json({ error: authorized.error, sessionStatus: authorized.sessionStatus });
    const summary = getSessionSummary(database, sessionId.data);
    const code = String(request.query.q ?? '').trim();
    const lookup = code ? buildLookup(database, sessionId.data, summary.locationId, code) : null;
    return response.json({
      session: {
        id: summary.id,
        status: summary.status,
        locationId: summary.locationId,
        direction: summary.direction,
        department: summary.department,
        section: summary.section,
      },
      summary,
      lookup,
    });
  });

  router.post('/sessions/:id/mobile-observations', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const parsed = mobileObservationSchema.safeParse(request.body);
    if (!sessionId.success || !parsed.success) {
      return response.status(400).json({ error: 'Observación móvil inválida.' });
    }
    const authorized = getPairing(database, sessionId.data, request);
    if (authorized.error) return response.status(authorized.status).json({ error: authorized.error, sessionStatus: authorized.sessionStatus });
    const summary = getSessionSummary(database, sessionId.data);
    const lookup = buildLookup(database, sessionId.data, summary.locationId, parsed.data.code);
    const selectedAsset = parsed.data.assetId
      ? lookup.matches.find(({ id }) => id === parsed.data.assetId)
      : lookup.asset;
    if (parsed.data.assetId && !selectedAsset) {
      return response.status(400).json({ error: 'El bien seleccionado no corresponde al código consultado.' });
    }
    if (lookup.ambiguous && !selectedAsset) {
      return response.status(409).json({
        error: 'El código escáner tiene múltiples coincidencias; seleccione el bien correcto.',
        matches: lookup.matches,
      });
    }
    if (selectedAsset?.alreadyObserved || (!selectedAsset && lookup.alreadyObserved)) {
      return response.status(409).json({ error: 'Este bien ya fue observado en la sesión.' });
    }
    const asset = selectedAsset;
    if (!asset) {
      return response.status(400).json({ error: 'Registre el bien no identificado mediante el formulario estructurado de incidencia.' });
    }
    const classification = classifyAsset(asset, summary.locationId);
    const data = {
      assetId: asset?.id ?? null,
      provisionalCode: asset ? null : parsed.data.code,
      status: parsed.data.status,
      locationId: summary.locationId,
      observation: parsed.data.observation,
      observedAt: parsed.data.observedAt,
      lookupCode: parsed.data.code,
      details: parsed.data.details,
      operatorCode: summary.operatorCode || '',
      deviceCode: parsed.data.deviceCode,
    };
    const validated = observationSchema.safeParse(data);
    if (!validated.success) return response.status(400).json({ error: 'Observación móvil inválida.' });
    if (classification === 'otra_ubicacion' && validated.data.status === 'verificado') {
      return response.status(409).json({ error: 'El bien pertenece a otra ubicación.' });
    }
    let saved;
    try {
      saved = database.transaction(() => saveObservation(database, sessionId.data, validated.data)).immediate();
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: 'Este bien ya fue observado en la sesión.' });
      throw error;
    }
    if (saved.error) return response.status(saved.status).json({ error: saved.error });
    return response.status(201).json({ observation: saved.observation, summary: getSessionSummary(database, sessionId.data) });
  });

  router.get('/sessions/:id/summary', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const summary = getSessionSummary(database, parsed.data);
    if (!summary) return response.status(404).json({ error: 'Sesión no encontrada.' });
    return response.json({ summary });
  });

  router.get('/sessions/history', (_request, response) => {
    const sessions = database.prepare(`
      SELECT id FROM inventory_sessions
      WHERE status_code IN ('closed', 'cancelled')
      ORDER BY COALESCE(completed_at, cancelled_at, started_at) DESC, id DESC
    `).all().map(({ id }) => getSessionSummary(database, id));
    return response.json({ sessions });
  });

  router.get('/sessions/:id/pending-assets', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const session = database.prepare(`
      SELECT location_id AS locationId FROM inventory_sessions WHERE id = ?
    `).get(parsed.data);
    if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
    const assets = database.prepare(`
      ${assetProjection()}
      WHERE a.location_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM observations o
          WHERE o.inventory_session_id = ?
            AND o.active = 1
            AND o.asset_id = a.id
            AND o.status_code IN ('verificado', 'dato_distinto', 'no_ubicado')
        )
      ORDER BY a.asset_code
    `).all(session.locationId, parsed.data);
    return response.json({ assets });
  });

  router.get('/sessions/:id/closure-readiness', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const readiness = evaluateFieldClosureReadiness(database, parsed.data, { evidenceRoot, verifyHashes: true });
    if (!readiness) return response.status(404).json({ error: 'Sesión no encontrada.' });
    return response.json({ readiness });
  });

  router.post('/sessions/:id/close', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    const confirmation = closeSchema.safeParse(request.body);
    if (!parsed.success || !confirmation.success) {
      return response.status(400).json({ error: 'El cierre requiere revisar y confirmar el levantamiento físico.' });
    }
    const result = database.transaction(() => {
      const currentSummary = getSessionSummary(database, parsed.data);
      if (!currentSummary) return { error: 'Sesión no encontrada.', status: 404 };
      if (currentSummary.status !== 'open') return { error: 'Sólo una sesión abierta puede finalizarse.', status: 409, summary: currentSummary };
      const readiness = evaluateFieldClosureReadiness(database, parsed.data, { evidenceRoot, verifyHashes: true });
      if (!readiness.ready) {
        return {
          error: `Faltan ${readiness.blockers.length} situaciones por resolver`,
          status: 409,
          readiness,
          summary: currentSummary,
        };
      }
      const closed = database.prepare(`
        UPDATE inventory_sessions
        SET status_code = 'closed',
            completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            closure_confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status_code = 'open'
      `).run(parsed.data);
      if (closed.changes !== 1) return { error: 'La sesión cambió durante el cierre.', status: 409 };
      database.prepare('DELETE FROM open_session_locks WHERE inventory_session_id = ?').run(parsed.data);
      revokeActivePairings(database, parsed.data, {
        operatorCode: confirmation.data.operatorCode, deviceCode: confirmation.data.deviceCode,
      }, 'session_closed');
      writeAudit(database, {
        action: 'session_closed', sessionId: parsed.data, entityType: 'session',
        entityCode: String(parsed.data), entityId: parsed.data,
        operatorCode: confirmation.data.operatorCode, deviceCode: confirmation.data.deviceCode,
        before: { status: 'open' }, after: { status: 'closed', readiness: readiness.metrics },
      });
      return { readiness };
    }).immediate();
    if (result.error) return response.status(result.status).json(result);
    return response.json({ summary: getSessionSummary(database, parsed.data), readiness: result.readiness });
  });

  router.post('/sessions/:id/cancel', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const parsed = cancellationSchema.safeParse(request.body);
    if (!sessionId.success || !parsed.success) {
      return response.status(400).json({ error: 'La cancelación requiere motivo y confirmación expresa.' });
    }

    const result = database.transaction(() => {
      const current = getSessionSummary(database, sessionId.data);
      if (!current) return { error: 'Sesión no encontrada.', status: 404 };
      if (current.status !== 'open') {
        return { error: 'Solo una sesión abierta puede cancelarse.', status: 409, summary: current };
      }
      database.prepare(`
        UPDATE inventory_sessions
        SET status_code = 'cancelled',
            cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            cancellation_reason = ?
        WHERE id = ? AND status_code = 'open'
      `).run(parsed.data.reason, sessionId.data);
      database.prepare('DELETE FROM open_session_locks WHERE inventory_session_id = ?').run(sessionId.data);
      revokeActivePairings(database, sessionId.data, {
        operatorCode: current.operatorCode || '', deviceCode: 'NOTEBOOK',
      }, 'session_cancelled');
      writeAudit(database, {
        action: 'session_cancelled', sessionId: sessionId.data,
        entityType: 'session', entityCode: String(sessionId.data), entityId: sessionId.data,
        operatorCode: current.operatorCode || '', deviceCode: 'NOTEBOOK',
        before: { status: 'open' }, after: { status: 'cancelled' },
        details: { reason: parsed.data.reason },
      });
      return { summary: getSessionSummary(database, sessionId.data) };
    }).immediate();

    if (result.error) return response.status(result.status).json(result);
    return response.json(result);
  });

  return router;
}
