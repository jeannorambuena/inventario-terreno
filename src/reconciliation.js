import { createHash } from 'node:crypto';

import { parseDetails } from './field-operations.js';
import { parseStructuredNotes } from './reporting.js';

const actionLabels = Object.freeze({
  maintain: 'MANTENER SIN CAMBIOS',
  regularize_location: 'REGULARIZAR UBICACIÓN',
  investigate_missing: 'INVESTIGAR NO ENCONTRADO',
  evaluate_disposal: 'EVALUAR BAJA',
  review_registration: 'REVISAR ALTA / INCORPORACIÓN',
  review_ownership: 'REVISAR PROPIEDAD / TERCERO',
  correct_label: 'CORREGIR / REPONER ETIQUETA',
  update_master: 'ACTUALIZAR DATOS DEL MAESTRO',
  review_required: 'REQUIERE REVISIÓN',
  no_action: 'SIN ACCIÓN ADMINISTRATIVA',
});

const incidenceLabels = Object.freeze({
  etiqueta_deteriorada: 'Etiqueta deteriorada',
  etiqueta_ilegible: 'Etiqueta ilegible',
  sin_etiqueta: 'Sin etiqueta',
  posible_etiqueta_duplicada: 'Posible etiqueta duplicada',
  posible_duplicacion: 'Posible etiqueta duplicada',
  datos_no_coinciden: 'Datos del maestro no coinciden',
  caracteristicas_no_coinciden: 'Datos del maestro no coinciden',
  pendiente_identificar: 'Pendiente de identificar',
  regular: 'Estado regular',
  malo: 'Estado malo',
  no_operativo: 'No operativo',
  incompleto: 'Incompleto',
  propuesta_baja: 'Propuesta de baja',
  otra_ubicacion: 'Encontrado en otra ubicación',
  en_reparacion: 'En reparación',
  prestamo_informado: 'Préstamo informado',
  traslado_no_regularizado: 'Traslado no regularizado',
  bien_tercero: 'Bien de tercero / arriendo informado',
  bien_no_registrado: 'Bien no registrado',
  requiere_revision: 'Requiere revisión',
  pendiente_revision: 'Requiere revisión',
});

const outcomeLabels = Object.freeze({
  verificado: 'CONFORME',
  dato_distinto: 'ENCONTRADO CON DIFERENCIAS',
  otra_ubicacion: 'OTRA UBICACIÓN',
  no_ubicado: 'NO ENCONTRADO',
  desconocido: 'HALLAZGO ADICIONAL',
  pendiente: 'PENDIENTE DE LEVANTAMIENTO',
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function location(direction, department, section) {
  if (![direction, department, section].some(Boolean)) return null;
  return { direction: direction || '', department: department || '', section: section || '' };
}

function deriveCodes({ status, official, structured, details }) {
  if (!status) return ['no_action'];

  const identification = structured.identification || [];
  const physical = structured.physical || [];
  const situations = unique([...(structured.situation || []), ...(details.situations || [])]);
  const codes = [];

  if (status === 'no_ubicado') codes.push('investigate_missing');
  if (status === 'otra_ubicacion' || situations.includes('otra_ubicacion')) codes.push('regularize_location');
  if (details.proposedDisposal || physical.includes('propuesta_baja')) codes.push('evaluate_disposal');
  if (!official || situations.includes('bien_no_registrado')) codes.push('review_registration');
  if (situations.includes('bien_tercero')) codes.push('review_ownership');
  if (identification.some((value) => [
    'etiqueta_deteriorada', 'etiqueta_ilegible', 'sin_etiqueta',
    'posible_etiqueta_duplicada', 'posible_duplicacion',
  ].includes(value)) || ['deteriorada', 'ilegible', 'sin_etiqueta', 'posible_duplicada'].includes(details.label)) {
    codes.push('correct_label');
  }
  if (identification.some((value) => ['datos_no_coinciden', 'caracteristicas_no_coinciden'].includes(value))
    || (details.discrepancies || []).length > 0) codes.push('update_master');
  if (situations.some((value) => ['requiere_revision', 'pendiente_revision'].includes(value))) {
    codes.push('review_required');
  }
  if (codes.length === 0 && status === 'verificado') codes.push('maintain');
  if (codes.length === 0) codes.push('no_action');
  return unique(codes);
}

export function deriveProposedActions(input) {
  return deriveCodes(input).map((code) => ({ code, label: actionLabels[code] }));
}

function incidenceList(structured, details) {
  const codes = unique([
    ...(structured.identification || []),
    ...(structured.physical || []),
    ...(structured.situation || []),
    ...(details.situations || []),
    ...(details.proposedDisposal ? ['propuesta_baja'] : []),
  ]);
  return codes.map((code) => ({ code, label: incidenceLabels[code] || code }));
}

function evidenceMap(database, sessionId) {
  const grouped = new Map();
  const rows = database.prepare(`
    SELECT e.id, e.observation_id AS observationId, e.evidence_type AS type,
      e.sha256, e.byte_size AS byteSize
    FROM evidence_files e
    JOIN observations o ON o.id = e.observation_id
    WHERE e.inventory_session_id = ? AND e.active = 1 AND o.active = 1
    ORDER BY e.id
  `).all(sessionId);
  for (const row of rows) {
    if (!grouped.has(row.observationId)) grouped.set(row.observationId, []);
    grouped.get(row.observationId).push({
      ...row,
      url: `/api/sessions/${sessionId}/observations/${row.observationId}/evidence/${row.id}`,
    });
  }
  return grouped;
}

function rowFromRecord(record, session, evidenceByObservation) {
  const official = Boolean(record.assetId);
  const details = parseDetails(record.detailsJson);
  const structured = parseStructuredNotes(record.notes || '');
  const actions = deriveProposedActions({ status: record.status, official, structured, details });
  const incidences = incidenceList(structured, details);
  const masterLocation = official
    ? location(record.masterDirection, record.masterDepartment, record.masterSection)
    : null;
  const observedLocation = record.status === 'no_ubicado' || !record.status
    ? null
    : location(session.direction, session.department, session.section);

  return {
    kind: official ? 'master_asset' : 'additional_finding',
    assetId: record.assetId || null,
    observationId: record.observationId || null,
    observationCode: record.observationCode || null,
    code: official ? record.assetCode : record.provisionalCode,
    name: official ? record.assetName : (details.provisional?.description || 'Bien físico adicional'),
    brand: official ? record.brand : (details.provisional?.brand || ''),
    model: official ? record.model : (details.provisional?.model || ''),
    serialNumber: official ? record.serialNumber : (details.provisional?.serialNumber || ''),
    masterLocation,
    observedLocation,
    physicalPoint: details.physicalPoint || null,
    outcomeCode: record.status || 'pendiente',
    outcome: outcomeLabels[record.status || 'pendiente'],
    incidences,
    proposedActions: actions,
    primaryAction: actions[0],
    observedAt: record.observedAt || null,
    sessionId: session.id,
    sessionCode: session.sessionCode,
    evidence: evidenceByObservation.get(record.observationId) || [],
    traceabilityUrl: record.observationId
      ? `/reports?sessionId=${session.id}&trace=${encodeURIComponent(official ? record.assetCode : record.provisionalCode)}`
      : null,
    propertyBasis: incidences.some(({ code }) => code === 'bien_tercero')
      ? 'TERCERO INFORMADO / PROPIEDAD NO ACREDITADA'
      : official ? 'SEGÚN MAESTRO IMPORTADO' : 'NO DETERMINADA',
    notes: details.review?.detail || record.notes || '',
  };
}

function conclusions(summary) {
  return [
    `Se registró resultado de terreno para ${summary.bienesEsperadosRevisados} de ${summary.bienesEsperados} bienes asociados administrativamente a la sección.`,
    `${summary.bienesConformes} bien(es) fueron encontrados sin discrepancia registrada.`,
    `${summary.diferenciasUbicacion} bien(es) requieren revisar o regularizar su ubicación administrativa.`,
    `${summary.noUbicados} bien(es) no fueron ubicados durante la inspección; este resultado no constituye declaración de pérdida.`,
    `${summary.hallazgosProvisionales} hallazgo(s) físico(s) adicional(es) requieren determinar propiedad o eventual incorporación.`,
  ];
}

export function createReconciliationReport(database, session, summary) {
  const source = database.prepare(`
    SELECT source_name AS sourceName, sheet_name AS sheetName,
      row_count AS rowCount, created_at AS importedAt, source_checksum AS sourceChecksum
    FROM inventory_imports
    ORDER BY id DESC LIMIT 1
  `).get() || null;
  const evidenceByObservation = evidenceMap(database, session.id);
  const records = database.prepare(`
    SELECT a.id AS assetId, a.asset_code AS assetCode, a.name AS assetName,
      a.brand, a.model, a.serial_number AS serialNumber,
      master.direction AS masterDirection, master.department AS masterDepartment,
      master.section AS masterSection,
      o.id AS observationId, o.observation_code AS observationCode,
      o.provisional_code AS provisionalCode, o.status_code AS status,
      o.notes, o.observed_at AS observedAt, d.details_json AS detailsJson
    FROM assets a
    JOIN locations master ON master.id = a.location_id
    LEFT JOIN observations o ON o.asset_id = a.id
      AND o.inventory_session_id = ? AND o.active = 1
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE a.location_id = ?
    UNION ALL
    SELECT a.id, a.asset_code, a.name, a.brand, a.model, a.serial_number,
      master.direction, master.department, master.section,
      o.id, o.observation_code, o.provisional_code, o.status_code,
      o.notes, o.observed_at, d.details_json
    FROM observations o
    JOIN assets a ON a.id = o.asset_id
    JOIN locations master ON master.id = a.location_id
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE o.inventory_session_id = ? AND o.active = 1 AND a.location_id <> ?
    UNION ALL
    SELECT NULL, NULL, NULL, '', '', '', NULL, NULL, NULL,
      o.id, o.observation_code, o.provisional_code, o.status_code,
      o.notes, o.observed_at, d.details_json
    FROM observations o
    LEFT JOIN observation_details d ON d.observation_id = o.id
    WHERE o.inventory_session_id = ? AND o.active = 1 AND o.asset_id IS NULL
    ORDER BY assetCode, provisionalCode
  `).all(session.id, session.locationId, session.id, session.locationId, session.id);
  const rows = records.map((record) => rowFromRecord(record, session, evidenceByObservation));
  const regularizations = new Map();
  for (const row of rows) {
    for (const action of row.proposedActions) {
      if (['maintain', 'no_action'].includes(action.code)) continue;
      if (!regularizations.has(action.code)) regularizations.set(action.code, { ...action, items: [] });
      regularizations.get(action.code).items.push(row);
    }
  }
  const snapshotAt = database.prepare(`
    SELECT MAX(created_at) AS value FROM audit_log WHERE inventory_session_id = ?
  `).get(session.id)?.value || session.startedAt;
  const report = {
    schemaVersion: 1,
    reportCode: `CONC-S${session.id}-L${session.locationId}`,
    status: session.status === 'closed' ? 'FINAL' : 'BORRADOR — SESIÓN NO CERRADA',
    snapshotAt,
    session: {
      id: session.id,
      sessionCode: session.sessionCode,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      operatorCode: session.operatorCode,
      direction: session.direction,
      department: session.department,
      section: session.section,
    },
    masterSource: source,
    summary,
    conclusions: conclusions(summary),
    rows,
    regularizations: [...regularizations.values()],
  };
  return {
    ...report,
    digestAlgorithm: 'SHA-256',
    digestScope: 'reconciliation-report-v1',
    digestSha256: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
  };
}

export { actionLabels };
