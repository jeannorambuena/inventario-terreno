import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  getFieldEvidencePolicy,
  validateFieldRequirements,
} from '../public/field-rules.js';

function details(overrides = {}) {
  return {
    label: 'correcta',
    physicalCondition: 'bueno',
    functionality: 'operativo',
    proposedDisposal: false,
    situations: [],
    physicalPoint: {
      type: '',
      reference: '',
    },
    provisional: {
      description: '',
      brand: '',
      model: '',
      serialNumber: '',
      observedCode: '',
      pendingIdentification: false,
    },
    discrepancies: [],
    discrepancyIndicated: false,
    incomplete: {
      parts: [],
      other: '',
    },
    review: {
      reason: '',
      detail: '',
    },
    custody: {
      destination: '',
      reference: '',
      basis: '',
    },
    ...overrides,
  };
}

describe('shared field requirements', () => {
  test('provisional finding requires identity, location and full-item evidence', () => {
    const value = details();

    const errors = validateFieldRequirements({
      assetId: null,
      status: 'desconocido',
      details: value,
    });

    expect(errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'provisional_situation',
        'provisional_description',
        'physical_point',
      ]),
    );

    expect(
      getFieldEvidencePolicy({
        assetId: null,
        status: 'desconocido',
        details: value,
      }).required,
    ).toContain('bien_completo');
  });

  test('ordinary official incidence does not require physical point', () => {
    const errors = validateFieldRequirements({
      assetId: 10,
      status: 'dato_distinto',
      details: details(),
    });

    expect(
      errors.some(({ code }) => code === 'physical_point'),
    ).toBe(false);
  });

  test('other location requires situation and physical point', () => {
    const errors = validateFieldRequirements({
      assetId: 10,
      status: 'otra_ubicacion',
      details: details(),
    });

    expect(errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'missing_other_location',
        'physical_point',
      ]),
    );
  });

  test('pending identification requires two evidence types', () => {
    const value = details({
      situations: [
        'bien_no_registrado',
        'requiere_revision',
      ],
      physicalPoint: {
        type: 'patio',
        reference: '',
      },
      provisional: {
        description: 'Bien por identificar',
        brand: '',
        model: '',
        serialNumber: '',
        observedCode: '',
        pendingIdentification: true,
      },
      review: {
        reason: 'identificacion',
        detail: '',
      },
    });

    const policy = getFieldEvidencePolicy({
      assetId: null,
      status: 'desconocido',
      details: value,
    });

    expect(policy.required).toEqual(
      expect.arrayContaining([
        'bien_completo',
        'serie_modelo',
      ]),
    );
  });

  test('custody situation requires destination and information basis', () => {
    const errors = validateFieldRequirements({
      assetId: 10,
      status: 'dato_distinto',
      details: details({
        situations: ['prestamo_informado'],
      }),
    });

    expect(errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'missing_destination',
        'missing_information_basis',
      ]),
    );
  });

  test('mobile and server both consume the shared rules module', () => {
    const mobile = readFileSync(
      new URL('../public/mobile.js', import.meta.url),
      'utf8',
    );

    const server = readFileSync(
      new URL('../src/field-operations.js', import.meta.url),
      'utf8',
    );

    expect(mobile).toContain(
      "from './field-rules.js'",
    );
    expect(server).toContain(
      "from '../public/field-rules.js'",
    );
  });
});
