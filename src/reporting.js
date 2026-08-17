const labels = Object.freeze({
  identification: Object.freeze({
    etiqueta_deteriorada: 'Etiqueta deteriorada',
    etiqueta_ilegible: 'Etiqueta ilegible',
    sin_etiqueta: 'Sin etiqueta',
    posible_etiqueta_duplicada: 'Posible etiqueta duplicada',
    posible_duplicacion: 'Posible etiqueta duplicada',
    datos_no_coinciden: 'Datos del bien no coinciden',
    caracteristicas_no_coinciden: 'Datos del bien no coinciden',
    pendiente_identificar: 'Pendiente de identificar',
  }),
  physical: Object.freeze({
    regular: 'Regular',
    malo: 'Malo',
    no_operativo: 'No operativo',
    incompleto: 'Incompleto',
    propuesta_baja: 'Propuesta de baja',
  }),
  situation: Object.freeze({
    otra_ubicacion: 'Encontrado en otra ubicación',
    en_reparacion: 'En reparación',
    prestamo_informado: 'Préstamo informado',
    traslado_no_regularizado: 'Traslado no regularizado',
    bien_tercero: 'Bien de tercero / no municipal',
    bien_no_registrado: 'Bien no registrado',
    requiere_revision: 'Requiere revisión',
    pendiente_revision: 'Requiere revisión',
  }),
  evidence: Object.freeze({
    bien_completo: 'Bien completo',
    etiqueta_patrimonial: 'Etiqueta patrimonial',
    serie_modelo: 'Serie / modelo',
    dano: 'Daño',
    ubicacion: 'Ubicación',
  }),
});

export const actionableFilters = Object.freeze([
  'no_encontrado',
  'problema_etiqueta',
  'sin_etiqueta',
  'datos_no_coinciden',
  'no_operativo',
  'malo',
  'propuesta_baja',
  'otra_ubicacion',
  'bien_no_registrado',
  'pendiente_identificar',
  'requiere_revision',
  'con_fotografia',
]);

const statusLabels = Object.freeze({
  verificado: 'Encontrado conforme',
  dato_distinto: 'Encontrado con diferencia',
  otra_ubicacion: 'Encontrado en otra ubicación',
  no_ubicado: 'No encontrado durante la inspección',
  desconocido: 'Hallazgo provisional',
});

function unique(values) {
  return [...new Set(values)];
}

export function parseStructuredNotes(notes = '') {
  const parsed = {
    identification: [],
    physical: [],
    situation: [],
    evidenceTypes: [],
    evidencePaths: [],
  };
  const groupMap = {
    IDENTIFICACION: 'identification',
    ESTADO_FISICO: 'physical',
    SITUACION: 'situation',
    EVIDENCIA_TIPO: 'evidenceTypes',
    EVIDENCIA_ARCHIVO: 'evidencePaths',
  };
  for (const match of String(notes).matchAll(/\[([A-Z_]+):([^\]]+)\]/g)) {
    const group = groupMap[match[1]];
    if (group) parsed[group].push(match[2].trim());
  }
  for (const group of Object.keys(parsed)) parsed[group] = unique(parsed[group]);
  return parsed;
}

function includesAny(values, candidates) {
  return candidates.some((candidate) => values.includes(candidate));
}

export function deriveIncidenceFlags({ status, provisionalCode, structured }) {
  const { identification, physical, situation, evidencePaths } = structured;
  return {
    no_encontrado: status === 'no_ubicado',
    problema_etiqueta: includesAny(identification, [
      'etiqueta_deteriorada', 'etiqueta_ilegible', 'sin_etiqueta',
      'posible_etiqueta_duplicada', 'posible_duplicacion',
    ]),
    sin_etiqueta: identification.includes('sin_etiqueta'),
    datos_no_coinciden: includesAny(identification, ['datos_no_coinciden', 'caracteristicas_no_coinciden']),
    no_operativo: physical.includes('no_operativo'),
    malo: physical.includes('malo'),
    propuesta_baja: physical.includes('propuesta_baja'),
    otra_ubicacion: status === 'otra_ubicacion' || situation.includes('otra_ubicacion'),
    bien_no_registrado: Boolean(provisionalCode) || situation.includes('bien_no_registrado'),
    pendiente_identificar: identification.includes('pendiente_identificar'),
    requiere_revision: includesAny(situation, ['requiere_revision', 'pendiente_revision']),
    con_fotografia: evidencePaths.length > 0,
  };
}

export function derivePriority(flags, structured) {
  if (
    includesAny(structured.identification, ['posible_etiqueta_duplicada', 'posible_duplicacion'])
    || flags.bien_no_registrado
    || flags.datos_no_coinciden
    || flags.propuesta_baja
    || flags.requiere_revision
  ) return 'alta';
  if (
    flags.otra_ubicacion
    || flags.no_operativo
    || flags.sin_etiqueta
    || flags.pendiente_identificar
  ) return 'media';
  return 'baja';
}

export function deriveActions(flags, structured) {
  const actions = [];
  if (flags.no_encontrado) actions.push('Investigar bien no encontrado');
  if (includesAny(structured.identification, ['etiqueta_deteriorada', 'etiqueta_ilegible', 'sin_etiqueta'])) {
    actions.push('Reponer etiqueta');
  }
  if (flags.pendiente_identificar) actions.push('Identificar bien');
  if (flags.otra_ubicacion) actions.push('Verificar ubicación');
  if (structured.situation.includes('traslado_no_regularizado')) actions.push('Regularizar traslado');
  if (
    flags.datos_no_coinciden
    || flags.requiere_revision
    || includesAny(structured.identification, ['posible_etiqueta_duplicada', 'posible_duplicacion'])
  ) actions.push('Revisar registro maestro');
  if (flags.no_operativo || structured.situation.includes('en_reparacion')) actions.push('Evaluar reparación');
  if (flags.propuesta_baja) actions.push('Evaluar baja');
  if (flags.bien_no_registrado) actions.push('Revisar bien no registrado');
  if (flags.datos_no_coinciden) actions.push('Resolver discrepancia');
  if (structured.situation.includes('prestamo_informado') || structured.situation.includes('en_reparacion')) {
    actions.push('Revisar documentación');
  }
  return unique(actions);
}

export function describeIncidence(row, evidenceUrlBuilder = () => null) {
  const structured = parseStructuredNotes(row.notes);
  const flags = deriveIncidenceFlags({
    status: row.status,
    provisionalCode: row.provisionalCode,
    structured,
  });
  const legacyEvidence = structured.evidencePaths.map((path, index) => ({
    type: structured.evidenceTypes[index] || structured.evidenceTypes[0] || 'bien_completo',
    typeLabel: labels.evidence[structured.evidenceTypes[index] || structured.evidenceTypes[0]] || 'Evidencia',
    url: evidenceUrlBuilder(index, path),
    available: true,
    state: 'available',
  }));
  const evidence = row.evidenceRecords?.length
    ? row.evidenceRecords.map((record) => ({
      ...record,
      typeLabel: labels.evidence[record.type] || 'Evidencia',
    }))
    : legacyEvidence;
  flags.con_fotografia = evidence.length > 0;
  const official = Boolean(row.assetId);
  const fieldDetails = row.fieldDetails || {};
  return {
    id: row.id,
    observationCode: row.observationCode,
    sessionId: row.sessionId,
    observedAt: row.observedAt,
    status: row.status,
    presenceCondition: statusLabels[row.status] || 'Condición registrada',
    assetId: row.assetId,
    assetCode: official ? row.assetCode : null,
    provisionalCode: official ? null : row.provisionalCode,
    displayCode: official ? row.assetCode : row.provisionalCode,
    assetName: official ? row.assetName : (fieldDetails.provisional?.description || 'BIEN FÍSICO NO REGISTRADO'),
    recordKind: official ? 'ACTIVO DEL MAESTRO' : 'HALLAZGO PROVISIONAL',
    sessionLocation: {
      direction: row.sessionDirection,
      department: row.sessionDepartment,
      section: row.sessionSection,
    },
    registeredLocation: official ? {
      direction: row.registeredDirection,
      department: row.registeredDepartment,
      section: row.registeredSection,
    } : null,
    physicalLocation: {
      direction: row.physicalDirection,
      department: row.physicalDepartment,
      section: row.physicalSection,
    },
    physicalPoint: fieldDetails.physicalPoint || null,
    provisionalDetails: official ? null : (fieldDetails.provisional || null),
    discrepancies: fieldDetails.discrepancies || [],
    incomplete: fieldDetails.incomplete || null,
    review: fieldDetails.review || null,
    custody: fieldDetails.custody || null,
    labelCondition: fieldDetails.label || null,
    physicalCondition: fieldDetails.physicalCondition || null,
    functionality: fieldDetails.functionality || null,
    proposedDisposal: Boolean(fieldDetails.proposedDisposal),
    versionNumber: row.versionNumber || 1,
    identification: structured.identification.map((code) => ({ code, label: labels.identification[code] || code })),
    physical: structured.physical.map((code) => ({ code, label: labels.physical[code] || code })),
    situation: structured.situation.map((code) => ({ code, label: labels.situation[code] || code })),
    flags,
    priority: derivePriority(flags, structured),
    actions: deriveActions(flags, structured),
    evidence,
    evidenceCount: evidence.length,
    evidenceComplete: evidence.every(({ available }) => available !== false),
  };
}

export function filterIncidences(incidences, requestedFilters = []) {
  return incidences.filter(({ flags }) => requestedFilters.every((filter) => flags[filter]));
}

export function buildAlerts(summary, incidences) {
  const alerts = [];
  const add = (code, message, action) => alerts.push({ code, message, action });
  if (summary.status === 'closed' && summary.pendientes > 0) {
    add('cierre_con_pendientes', 'Sección cerrada con bienes pendientes de verificar.', 'Revisar pendientes');
  }
  const rules = [
    ['otra_ubicacion', 'Hay bienes registrados en una ubicación diferente.', 'Verificar ubicación'],
    ['bien_no_registrado', 'Hay bienes físicos no registrados en el maestro.', 'Revisar bien no registrado'],
    ['datos_no_coinciden', 'Hay datos físicos que no coinciden con el maestro.', 'Revisar registro maestro'],
    ['no_operativo', 'Hay bienes no operativos.', 'Evaluar reparación'],
    ['propuesta_baja', 'Hay bienes con propuesta de baja.', 'Evaluar baja'],
    ['pendiente_identificar', 'Hay bienes pendientes de identificar.', 'Identificar bien'],
    ['requiere_revision', 'Hay incidencias que requieren revisión posterior.', 'Revisar incidencia'],
  ];
  for (const [flag, message, action] of rules) {
    if (incidences.some(({ flags }) => flags[flag])) add(flag, message, action);
  }
  if (incidences.some(({ identification }) => identification.some(({ code }) => (
    code === 'posible_etiqueta_duplicada' || code === 'posible_duplicacion'
  )))) add('posible_duplicado', 'Hay una posible etiqueta duplicada.', 'Revisar registro maestro');
  return alerts;
}

export function groupRegularization(incidences) {
  const grouped = new Map();
  for (const incidence of incidences) {
    for (const action of incidence.actions) {
      if (!grouped.has(action)) grouped.set(action, []);
      grouped.get(action).push({
        incidenceId: incidence.id,
        sessionId: incidence.sessionId,
        code: incidence.displayCode,
        name: incidence.assetName,
        priority: incidence.priority,
      });
    }
  }
  return [...grouped.entries()].map(([action, items]) => ({ action, count: items.length, items }));
}
