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

describe('dashboard avanzado', () => {
  test('incluye analitica y actividad reciente', () => {
    expect(html).toContain(
      'id="explorer-donut"',
    );

    expect(html).toContain(
      'id="explorer-recent"',
    );
  });

  test('clasifica resultados sin duplicar observaciones', () => {
    expect(js).toContain(
      'function explorerOutcome(observation)',
    );

    expect(js).toContain(
      'function renderExplorerAnalytics(',
    );
  });

  test('incluye buscador de bienes por seccion', () => {
    expect(html).toContain(
      'id="explorer-search"',
    );

    expect(js).toContain(
      'state.explorerQuery',
    );
  });

  test('incluye ficha para bienes esperados', () => {
    expect(html).toContain(
      'id="asset-dialog"',
    );

    expect(js).toContain(
      'function openAssetDossier(',
    );
  });

  test('la ficha diferencia maestro y terreno', () => {
    expect(js).toContain(
      "'Registro maestro'",
    );

    expect(js).toContain(
      "'Resultado del levantamiento'",
    );
  });

  test('mantiene acceso a incidencia y evidencia', () => {
    expect(js).toContain(
      "'Ver incidencia y evidencia'",
    );

    expect(js).toContain(
      'openIncidence(',
    );
  });

  test('incluye modo presentacion', () => {
    expect(html).toContain(
      'id="dashboard-presentation-mode"',
    );

    expect(css).toContain(
      'body.dashboard-presentation',
    );
  });

  test('la seccion conserva actualizacion en vivo', () => {
    expect(js).toContain(
      'renderExplorerAnalytics(',
    );

    expect(js).toContain(
      'state.explorerObservations',
    );
  });
});
