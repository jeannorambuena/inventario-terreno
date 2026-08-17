const tagGroups = Object.freeze({
  identification: 'IDENTIFICACION',
  physical: 'ESTADO_FISICO',
  situation: 'SITUACION',
});

export const incidenceCatalog = Object.freeze({
  identification: Object.freeze([
    'etiqueta_deteriorada',
    'etiqueta_ilegible',
    'sin_etiqueta',
    'posible_etiqueta_duplicada',
    'datos_no_coinciden',
    'pendiente_identificar',
  ]),
  physical: Object.freeze([
    'regular',
    'malo',
    'no_operativo',
    'incompleto',
    'propuesta_baja',
  ]),
  situation: Object.freeze([
    'otra_ubicacion',
    'en_reparacion',
    'prestamo_informado',
    'traslado_no_regularizado',
    'bien_tercero',
    'bien_no_registrado',
    'requiere_revision',
  ]),
  evidence: Object.freeze([
    'bien_completo',
    'etiqueta_patrimonial',
    'serie_modelo',
    'dano',
    'ubicacion',
  ]),
});

function cleanValues(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export function serializeIncidence({
  identification = [],
  physical = [],
  situation = [],
  complementary = [],
  evidenceType = '',
  evidencePath = '',
  note = '',
} = {}) {
  const valuesByGroup = {
    identification,
    physical,
    situation: [...situation, ...complementary],
  };
  const tags = [];
  for (const [group, label] of Object.entries(tagGroups)) {
    for (const value of cleanValues(valuesByGroup[group])) tags.push(`[${label}:${value}]`);
  }
  if (evidenceType) tags.push(`[EVIDENCIA_TIPO:${String(evidenceType).trim()}]`);
  if (evidencePath) tags.push(`[EVIDENCIA_ARCHIVO:${String(evidencePath).trim()}]`);
  const detail = String(note).trim();
  return [...tags, detail].filter(Boolean).join(' ').slice(0, 2000);
}

export function readIncidenceSelections(form) {
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)]
    .map(({ value }) => value);
  return {
    identification: checked('identification'),
    physical: checked('physical'),
    situation: checked('situation'),
  };
}

export function readIncidenceForm(form) {
  return serializeIncidence(readIncidenceSelections(form));
}
