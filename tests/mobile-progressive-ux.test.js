import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  normalizeFieldDetails,
  validateFieldDetails,
} from '../src/field-operations.js';

const html = readFileSync(
  new URL('../public/mobile.html', import.meta.url),
  'utf8',
);

const mobile = readFileSync(
  new URL('../public/mobile.js', import.meta.url),
  'utf8',
);

describe('progressive mobile field capture', () => {
  test('organizes capture in operational order', () => {
    const titles = [
      'Identificación',
      'Dónde está',
      'Cómo está',
      'Qué situación existe',
      'Evidencia',
      'Confirmar',
    ];

    let previous = -1;

    for (const title of titles) {
      const position = html.indexOf(title);

      expect(position).toBeGreaterThan(previous);

      previous = position;
    }
  });

  test('keeps backend status hidden from the operator', () => {
    expect(html).toContain(
      '<div class="system-field" hidden>',
    );

    expect(html).toContain(
      'id="status"',
    );
  });

  test('requires explicit incidence condition values', () => {
    const normalized = normalizeFieldDetails({
      label: '',
      physicalCondition: '',
      functionality: '',
      situations: [],
    });

    const errors = validateFieldDetails({
      assetId: 10,
      status: 'dato_distinto',
      details: normalized,
      isIncidence: true,
    });

    expect(
      errors.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        'invalid_label',
        'invalid_physical_condition',
        'invalid_functionality',
      ]),
    );
  });

  test('contains live missing-data guidance', () => {
    expect(html).toContain(
      'id="mobile-readiness-title"',
    );

    expect(html).toContain(
      'id="mobile-requirements"',
    );

    expect(mobile).toContain(
      'function refreshCaptureProgress()',
    );

    expect(mobile).toContain(
      '✓ LISTO PARA GUARDAR',
    );

    expect(mobile).toContain(
      'FALTAN ${errors.length}',
    );
  });

  test('serves shared field rules to the mobile LAN client', () => {
    const server = readFileSync(
      new URL('../src/server.js', import.meta.url),
      'utf8',
    );

    expect(server).toContain(
      "'/field-rules.js'",
    );
  });

  test('opens discrepancy details only when requested', () => {
    expect(html).toContain(
      'id="mobile-has-discrepancy"',
    );

    expect(mobile).toContain(
      "const discrepancyIndicated =",
    );

    expect(mobile).toContain(
      "'#mobile-has-discrepancy'",
    );
  });
  test('marks required evidence progressively', () => {
    expect(mobile).toContain(
      'function refreshEvidenceGuidance(evidencePolicy)',
    );

    expect(mobile).toContain(
      "'evidence-type--required'",
    );

    expect(mobile).toContain(
      "'OBLIGATORIA'",
    );

    expect(mobile).toContain(
      "'LISTA'",
    );

    expect(mobile).toContain(
      'refreshEvidenceGuidance(evidencePolicy);',
    );
  });

  test('shows no additional situation when only hidden system state applies', () => {
    expect(mobile).toContain(
      "status.textContent = 'Sin adicional';",
    );

    expect(mobile).toContain(
      "input[name=\"situation\"]:checked",
    );

    expect(mobile).toContain(
      "!input.closest('label')?.hidden",
    );
  });

  test('provides contextual help for all capture sections', () => {
    expect(
      (html.match(/class="section-help"/g) || []).length,
    ).toBe(6);

    for (const section of [
      'identification',
      'location',
      'condition',
      'situation',
      'evidence',
      'confirm',
    ]) {
      expect(html).toContain(
        `data-help-for="${section}"`,
      );
    }
  });

});
