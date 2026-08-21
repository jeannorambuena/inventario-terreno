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

describe(
  'persistencia y comparticion del dashboard',
  () => {
    test('incluye enlace compartible', () => {
      expect(html).toContain(
        'id="executive-query-copy-link"',
      );

      expect(js).toContain(
        'function copyDashboardLink()',
      );
    });

    test('guarda location y tab en url', () => {
      expect(js).toContain(
        "'locationId'",
      );

      expect(js).toContain(
        "'tab'",
      );

      expect(js).toContain(
        'function updateDashboardUrl(',
      );
    });

    test('restaura seccion desde url', () => {
      expect(js).toContain(
        'function restoreExplorerLocationFromUrl()',
      );

      expect(js).toContain(
        'await restoreExplorerLocationFromUrl();',
      );
    });

    test('restaura consulta jerarquica', () => {
      expect(js).toContain(
        'function restoreDashboardQueryState()',
      );

      expect(js).toContain(
        "'level'",
      );

      expect(js).toContain(
        "'unit'",
      );
    });

    test('incluye narrativa ejecutiva', () => {
      expect(html).toContain(
        'id="executive-query-narrative"',
      );

      expect(js).toContain(
        'function executiveNarrative(',
      );

      expect(js).toContain(
        'function renderExecutiveNarrative(',
      );
    });

    test('permite exportar consulta ejecutiva', () => {
      expect(html).toContain(
        'id="executive-query-export"',
      );

      expect(js).toContain(
        'function downloadExecutiveQueryCsv()',
      );
    });

    test('exportacion incluye metricas de gestion', () => {
      expect(js).toContain(
        "'Cobertura %'",
      );

      expect(js).toContain(
        "'Conformidad %'",
      );

      expect(js).toContain(
        "'Tasa incidencia %'",
      );
    });

    test('permanece responsive', () => {
      expect(css).toContain(
        '.executive-query__toolbar',
      );

      expect(css).toContain(
        '@media (max-width: 620px)',
      );
    });
  },
);
