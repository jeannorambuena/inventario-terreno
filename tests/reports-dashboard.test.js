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

describe('dashboard de control', () => {
  test('incluye los KPI ejecutivos', () => {
    expect(html).toContain(
      'id="dashboard-kpis"',
    );

    expect(html).toContain(
      'id="dashboard-directions"',
    );

    expect(html).toContain(
      'id="dashboard-summary"',
    );
  });

  test('renderiza indicadores desde datos reales', () => {
    expect(js).toContain(
      'function renderDashboard(overview)',
    );

    expect(js).toContain(
      'metrics.bienesEsperados',
    );

    expect(js).toContain(
      'metrics.bienesEsperadosRevisados',
    );

    expect(js).toContain(
      'metrics.noRegistrados',
    );
  });

  test('actualiza el dashboard automaticamente', () => {
    expect(js).toContain(
      "api('/api/reports/overview')",
    );

    expect(js).toContain(
      '5000',
    );

    expect(js).toContain(
      'startDashboardRefresh();',
    );
  });

  test('incluye presentacion responsiva del dashboard', () => {
    expect(css).toContain(
      '.dashboard-kpis',
    );

    expect(css).toContain(
      '.dashboard-v2__grid',
    );

    expect(css).toContain(
      '@media (max-width: 620px)',
    );
  });
});
