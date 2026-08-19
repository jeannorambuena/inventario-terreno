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

describe('capa BI de control', () => {
  test('incluye navegacion ejecutiva', () => {
    expect(html).toContain(
      'id="dashboard-bi-nav"',
    );

    expect(html).toContain(
      'href="#dashboard-priorities"',
    );
  });

  test('muestra estado global por secciones', () => {
    expect(html).toContain(
      'id="dashboard-unit-status"',
    );

    expect(js).toContain(
      'overall.sinIniciar',
    );

    expect(js).toContain(
      'overall.finalizadas',
    );
  });

  test('incluye ranking operacional', () => {
    expect(html).toContain(
      'id="dashboard-priority-list"',
    );

    expect(js).toContain(
      'function sectionOperationalPriority(',
    );

    expect(js).toContain(
      'function renderDashboardPriorities(',
    );
  });

  test('prioridad no se presenta como juicio juridico', () => {
    expect(html).toContain(
      'no constituye calificaci&oacute;n',
    );
  });

  test('permite abrir una seccion desde prioridades', () => {
    expect(js).toContain(
      'async function openExplorerLocation(',
    );

    expect(js).toContain(
      "'Abrir'",
    );
  });

  test('permite exportar la planilla de la seccion', () => {
    expect(html).toContain(
      'id="export-section-csv"',
    );

    expect(js).toContain(
      'function downloadExplorerCsv()',
    );

    expect(js).toContain(
      "'Hallazgo adicional'",
    );
  });

  test('csv diferencia maestro y hallazgos', () => {
    expect(js).toContain(
      "'Bien esperado'",
    );

    expect(js).toContain(
      "'Hallazgo adicional'",
    );
  });

  test('permite imprimir vista fisica', () => {
    expect(html).toContain(
      'id="print-physical-view"',
    );

    expect(js).toContain(
      'function printExplorerPhysical()',
    );

    expect(css).toContain(
      'body.print-physical-view',
    );
  });

  test('mantiene responsive el control BI', () => {
    expect(css).toContain(
      '.dashboard-bi-nav',
    );

    expect(css).toContain(
      '@media (max-width: 720px)',
    );
  });

  test('prioridades se actualizan desde overview vivo', () => {
    expect(js).toContain(
      'renderDashboardPriorities(overview);',
    );
  });
});
