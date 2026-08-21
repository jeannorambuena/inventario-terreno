const sectionForField = Object.freeze({
  'label': 'identification',
  'physicalCondition': 'condition',
  'functionality': 'condition',
  'situations': 'situation',
  'provisional.description': 'identification',
  'physicalPoint.type': 'location',
  'physicalPoint.reference': 'location',
  'discrepancies': 'identification',
  'incomplete.parts': 'condition',
  'incomplete.other': 'condition',
  'custody.destination': 'situation',
  'custody.basis': 'situation',
  'review.reason': 'situation',
});

function requirement(code, message, field) {
  return {
    code,
    message,
    field,
    section: sectionForField[field] || 'situation',
  };
}

export function validateFieldRequirements({
  assetId,
  status,
  details,
  isIncidence = true,
}) {
  if (!isIncidence && status === 'verificado') return [];

  const errors = [];

  const add = (code, message, field) => {
    errors.push(requirement(code, message, field));
  };

  if (
    !['correcta', 'deteriorada', 'ilegible', 'sin_etiqueta', 'posible_duplicada']
      .includes(details.label)
  ) {
    add(
      'invalid_label',
      'Seleccione un estado de etiqueta v\u00e1lido.',
      'label',
    );
  }

  if (
    !['bueno', 'regular', 'malo', 'incompleto']
      .includes(details.physicalCondition)
  ) {
    add(
      'invalid_physical_condition',
      'Seleccione la conservaci\u00f3n f\u00edsica.',
      'physicalCondition',
    );
  }

  if (
    !['operativo', 'operativo_con_falla', 'no_operativo', 'no_verificable']
      .includes(details.functionality)
  ) {
    add(
      'invalid_functionality',
      'Seleccione el funcionamiento.',
      'functionality',
    );
  }

  if (
    !assetId
    && !details.situations.includes('bien_no_registrado')
  ) {
    add(
      'provisional_situation',
      'Un hallazgo adicional debe clasificarse como bien no registrado.',
      'situations',
    );
  }

  if (
    assetId
    && details.situations.includes('bien_no_registrado')
  ) {
    add(
      'official_marked_unregistered',
      'Un bien identificado del maestro no puede marcarse como no registrado.',
      'situations',
    );
  }

  if (
    status === 'otra_ubicacion'
    && !details.situations.includes('otra_ubicacion')
  ) {
    add(
      'missing_other_location',
      'Falta indicar que el bien fue encontrado en otra ubicaci\u00f3n.',
      'situations',
    );
  }

  if (!assetId && !details.provisional.description) {
    add(
      'provisional_description',
      'Describa brevemente el bien adicional.',
      'provisional.description',
    );
  }

  const locationRequired =
    !assetId
    || status === 'otra_ubicacion'
    || details.provisional.pendingIdentification
    || details.situations.includes('requiere_revision')
    || details.situations.includes('traslado_no_regularizado');

  if (locationRequired && !details.physicalPoint.type) {
    add(
      'physical_point',
      'Indique el punto f\u00edsico donde se observ\u00f3 el bien.',
      'physicalPoint.type',
    );
  }

  if (
    details.physicalPoint.type === 'otro'
    && !details.physicalPoint.reference
  ) {
    add(
      'physical_reference',
      'Especifique brevemente el otro punto f\u00edsico.',
      'physicalPoint.reference',
    );
  }

  if (
    details.discrepancyIndicated
    || details.discrepancies.length > 0
  ) {
    if (details.discrepancies.length === 0) {
      add(
        'missing_discrepancy',
        'Indique qu\u00e9 dato no coincide.',
        'discrepancies',
      );
    }

    for (const discrepancy of details.discrepancies) {
      if (
        !discrepancy.observedValue
        && !discrepancy.pendingFromEvidence
      ) {
        add(
          'missing_observed_value',
          'Registre el valor observado o indique lectura posterior desde evidencia.',
          'discrepancies',
        );
      }
    }
  }

  if (details.physicalCondition === 'incompleto') {
    if (details.incomplete.parts.length === 0) {
      add(
        'missing_component',
        'Indique qu\u00e9 componente falta.',
        'incomplete.parts',
      );
    }

    if (
      details.incomplete.parts.includes('otro')
      && !details.incomplete.other
    ) {
      add(
        'missing_other_component',
        'Describa brevemente el componente faltante.',
        'incomplete.other',
      );
    }
  }

  const needsCustody = details.situations.some((value) =>
    [
      'en_reparacion',
      'prestamo_informado',
      'traslado_no_regularizado',
    ].includes(value)
  );

  if (needsCustody && !details.custody.destination) {
    add(
      'missing_destination',
      'Indique destino, unidad o persona relacionada con el bien.',
      'custody.destination',
    );
  }

  if (needsCustody && !details.custody.basis) {
    add(
      'missing_information_basis',
      'Indique si la informaci\u00f3n fue informada o verificada.',
      'custody.basis',
    );
  }

  if (
    details.situations.includes('requiere_revision')
    && !details.review.reason
  ) {
    add(
      'missing_review_reason',
      'Indique qu\u00e9 debe revisarse.',
      'review.reason',
    );
  }

  return errors;
}

export function getFieldEvidencePolicy({
  assetId,
  status,
  details,
}) {
  const required = new Set();
  const recommended = new Set();

  if (
    !assetId
    || details.situations.includes('bien_no_registrado')
  ) {
    required.add('bien_completo');
  }

  if (details.provisional.pendingIdentification) {
    required.add('bien_completo');
    required.add('serie_modelo');
  }

  if (
    status === 'dato_distinto'
    && details.discrepancies.some(
      ({ pendingFromEvidence }) => pendingFromEvidence,
    )
  ) {
    required.add('serie_modelo');
  }

  if (details.physicalCondition === 'incompleto') {
    recommended.add('bien_completo');
  }

  if (
    details.functionality === 'no_operativo'
    || details.proposedDisposal
  ) {
    recommended.add('bien_completo');
    recommended.add('dano');
  }

  if (status === 'otra_ubicacion') {
    recommended.add('ubicacion');
  }

  return {
    required: [...required],
    recommended: [...recommended]
      .filter((type) => !required.has(type)),
  };
}
