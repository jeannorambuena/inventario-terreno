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

describe('consulta ejecutiva jerarquica', () => {
  test('permite consultar distintos niveles', () => {
    expect(html).toContain(
      'id="executive-query-level"',
    );

    expect(html).toContain(
      'value="municipality"',
    );

    expect(html).toContain(
      'value="direction"',
    );

    expect(html).toContain(
      'value="department"',
    );

    expect(html).toContain(
      'value="section"',
    );
  });

  test('resuelve unidades usando overview', () => {
    expect(js).toContain(
      'function resolveExecutiveScope(',
    );

    expect(js).toContain(
      'function executiveScopeOptions(',
    );
  });

  test('calcula cobertura conformidad e incidencia', () => {
    expect(js).toContain(
      'coverage:',
    );

    expect(js).toContain(
      'conformity:',
    );

    expect(js).toContain(
      'incidenceRate:',
    );
  });

  test('muestra seis indicadores principales', () => {
    expect(js).toContain(
      "'Esperados'",
    );

    expect(js).toContain(
      "'Revisados'",
    );

    expect(js).toContain(
      "'Conformes'",
    );

    expect(js).toContain(
      "'Incidencias'",
    );

    expect(js).toContain(
      "'Pendientes'",
    );

    expect(js).toContain(
      "'Hallazgos'",
    );
  });

  test('compara unidades dependientes', () => {
    expect(js).toContain(
      'function renderExecutiveRanking(',
    );

    expect(html).toContain(
      'id="executive-query-ranking"',
    );
  });

  test('permite abrir seccion desde consulta', () => {
    expect(js).toContain(
      "'Abrir seccion completa'",
    );

    expect(js).toContain(
      'openExplorerLocation(',
    );
  });

  test('se actualiza con overview vivo', () => {
    expect(js).toContain(
      'renderExecutiveQuery();',
    );

    expect(js).toContain(
      'refreshDashboardOverview',
    );
  });

  test('es responsive', () => {
    expect(css).toContain(
      '.executive-query',
    );

    expect(css).toContain(
      '@media (max-width: 700px)',
    );
  });
});
