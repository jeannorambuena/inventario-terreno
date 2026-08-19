import {
  describe,
  expect,
  test,
} from 'vitest';

import {
  readFileSync,
} from 'node:fs';

const html = readFileSync(
  new URL(
    '../public/reports.html',
    import.meta.url,
  ),
  'utf8',
);

const js = readFileSync(
  new URL(
    '../public/reports.js',
    import.meta.url,
  ),
  'utf8',
);

const css = readFileSync(
  new URL(
    '../public/reports.css',
    import.meta.url,
  ),
  'utf8',
);

describe('vista fisica y control ejecutivo', () => {
  test('incluye matriz de incidencias', () => {
    expect(html).toContain(
      'id="explorer-incidence-matrix"',
    );

    expect(js).toContain(
      'function renderExplorerIncidenceMatrix(',
    );
  });

  test('incluye estado documental', () => {
    expect(html).toContain(
      'id="explorer-integrity-summary"',
    );

    expect(js).toContain(
      'function renderExplorerIntegrity(',
    );
  });

  test('incluye vista fisica por seccion', () => {
    expect(html).toContain(
      'data-explorer-tab="physical"',
    );

    expect(html).toContain(
      'id="explorer-physical"',
    );
  });

  test('vista fisica combina maestro y observaciones', () => {
    expect(js).toContain(
      'function renderExplorerPhysical(',
    );

    expect(js).toContain(
      "kind: 'expected'",
    );

    expect(js).toContain(
      "kind: 'finding'",
    );
  });

  test('no inventa fotografia cuando no existe evidencia', () => {
    expect(js).toContain(
      "'Sin fotografia requerida o disponible'",
    );

    expect(js).toContain(
      "'Pendiente de inspeccion'",
    );
  });

  test('incluye resumen ejecutivo de seccion', () => {
    expect(html).toContain(
      'data-explorer-tab="summary"',
    );

    expect(html).toContain(
      'id="explorer-summary-sheet"',
    );

    expect(js).toContain(
      'function renderExplorerSummary(',
    );
  });

  test('resumen contiene advertencia administrativa', () => {
    expect(js).toContain(
      "'Los hallazgos e incidencias describen lo observado '",
    );

    expect(js).toContain(
      "'el inventario maestro ni constituye regularizacion '",
    );
  });

  test('permite imprimir solo el resumen de la seccion', () => {
    expect(html).toContain(
      'id="print-section-summary"',
    );

    expect(css).toContain(
      'body.print-section-summary',
    );
  });
});
