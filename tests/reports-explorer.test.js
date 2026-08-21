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

describe('explorador del dashboard', () => {
  test('permite navegar direccion departamento seccion', () => {
    expect(html).toContain(
      'id="explorer-direction"',
    );

    expect(html).toContain(
      'id="explorer-department"',
    );

    expect(html).toContain(
      'id="explorer-section"',
    );
  });

  test('separa bienes esperados hallazgos y evidencias', () => {
    expect(html).toContain(
      'data-explorer-tab="expected"',
    );

    expect(html).toContain(
      'data-explorer-tab="findings"',
    );

    expect(html).toContain(
      'data-explorer-tab="evidence"',
    );
  });

  test('usa solo APIs existentes de inventario', () => {
    expect(js).toContain(
      '/api/assets?locationId=',
    );

    expect(js).toContain(
      '/observations',
    );

    expect(js).toContain(
      '/report',
    );
  });

  test('muestra solo observaciones activas entregadas por API', () => {
    expect(js).toContain(
      'renderExplorerAssets',
    );

    expect(js).toContain(
      'renderExplorerFindings',
    );
  });

  test('actualiza la seccion junto al dashboard', () => {
    expect(js).toContain(
      'refreshExplorerSection({',
    );

    expect(js).toContain(
      'silent: true',
    );
  });

  test('incluye galeria de evidencia', () => {
    expect(js).toContain(
      'renderExplorerEvidence',
    );

    expect(css).toContain(
      '.explorer-evidence',
    );
  });
});
