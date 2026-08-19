const elements = {
  sessionSelect: document.querySelector('#session-select'),
  printReport: document.querySelector('#print-report'),
  overviewCutoff: document.querySelector('#overview-cutoff'),
  dashboardLive: document.querySelector('#dashboard-live'),
  dashboardLastSync: document.querySelector('#dashboard-last-sync'),
  dashboardKpis: document.querySelector('#dashboard-kpis'),
  dashboardDirections: document.querySelector('#dashboard-directions'),
  dashboardSummary: document.querySelector('#dashboard-summary'),
  explorerDirection: document.querySelector('#explorer-direction'),
  explorerDepartment: document.querySelector('#explorer-department'),
  explorerSection: document.querySelector('#explorer-section'),
  explorerStatus: document.querySelector('#explorer-status'),
  explorerEmpty: document.querySelector('#explorer-empty'),
  explorerContent: document.querySelector('#explorer-content'),
  explorerBreadcrumb: document.querySelector('#explorer-breadcrumb'),
  explorerMetrics: document.querySelector('#explorer-metrics'),
  explorerAssets: document.querySelector('#explorer-assets'),
  explorerFindings: document.querySelector('#explorer-findings'),
  explorerEvidence: document.querySelector('#explorer-evidence'),
  explorerExpectedCount: document.querySelector('#explorer-expected-count'),
  explorerFindingsCount: document.querySelector('#explorer-findings-count'),
  explorerEvidenceCount: document.querySelector('#explorer-evidence-count'),
  explorerDonut: document.querySelector('#explorer-donut'),
  explorerDonutTotal: document.querySelector('#explorer-donut-total'),
  explorerOutcomeLegend: document.querySelector('#explorer-outcome-legend'),
  explorerRecent: document.querySelector('#explorer-recent'),
  explorerSearch: document.querySelector('#explorer-search'),
  explorerAssetsShown: document.querySelector('#explorer-assets-shown'),
  presentationMode: document.querySelector('#dashboard-presentation-mode'),
  assetDialog: document.querySelector('#asset-dialog'),
  assetDialogTitle: document.querySelector('#asset-dialog-title'),
  assetDialogSubtitle: document.querySelector('#asset-dialog-subtitle'),
  assetDialogContent: document.querySelector('#asset-dialog-content'),
  closeAssetDialog: document.querySelector('#close-asset-dialog'),
  explorerIncidenceMatrix: document.querySelector('#explorer-incidence-matrix'),
  explorerIntegritySummary: document.querySelector('#explorer-integrity-summary'),
  explorerPhysical: document.querySelector('#explorer-physical'),
  explorerPhysicalCount: document.querySelector('#explorer-physical-count'),
  explorerSummarySheet: document.querySelector('#explorer-summary-sheet'),
  printSectionSummary: document.querySelector('#print-section-summary'),
  overviewMetrics: document.querySelector('#overview-metrics'),
  overviewProgress: document.querySelector('#overview-progress'),
  unitTree: document.querySelector('#unit-tree'),
  sessionReport: document.querySelector('#session-report'),
  reportCutoff: document.querySelector('#report-cutoff'),
  reportScope: document.querySelector('#report-scope'),
  executiveProgress: document.querySelector('#executive-progress'),
  executiveResults: document.querySelector('#executive-results'),
  executiveSituations: document.querySelector('#executive-situations'),
  evidenceSummary: document.querySelector('#evidence-summary'),
  alertsSection: document.querySelector('#alerts-section'),
  alerts: document.querySelector('#alerts'),
  closeState: document.querySelector('#close-state'),
  closeDetails: document.querySelector('#close-details'),
  filters: document.querySelector('.incidence-filters'),
  incidenceCount: document.querySelector('#incidence-count'),
  incidenceList: document.querySelector('#incidence-list'),
  regularizationList: document.querySelector('#regularization-list'),
  message: document.querySelector('#report-message'),
  incidenceDialog: document.querySelector('#incidence-dialog'),
  incidenceKind: document.querySelector('#incidence-kind'),
  incidenceDetail: document.querySelector('#incidence-detail'),
  closeIncidence: document.querySelector('#close-incidence'),
  photoDialog: document.querySelector('#photo-dialog'),
  photoFull: document.querySelector('#photo-full'),
  photoType: document.querySelector('#photo-type'),
  closePhoto: document.querySelector('#close-photo'),
};

const state = {
  sessionId: null,
  report: null,
  overview: null,
  dashboardTimer: null,
  dashboardRefreshing: false,
  explorerLocationId: null,
  explorerSessionId: null,
  explorerRefreshing: false,
  explorerTab: 'expected',
};

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No fue posible consultar el informe local.');
  return body;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value) {
  if (!value) return 'Sin fecha registrada';
  return new Date(value).toLocaleString('es-CL');
}

function locationText(location) {
  return [location?.direction, location?.department, location?.section].filter(Boolean).join(' / ') || 'Sin ubicación registrada';
}

function setMessage(text, error = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle('error', error);
}

function appendDefinition(list, term, value) {
  const item = document.createElement('div');
  item.className = 'detail-item';
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value ?? '—';
  item.append(dt, dd);
  list.append(item);
}

function appendMetric(container, label, value, tone = '') {
  const article = document.createElement('article');
  if (tone) article.dataset.tone = tone;
  const span = document.createElement('span');
  span.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  article.append(span, strong);
  container.append(article);
}

function renderMetrics(container, metrics) {
  container.replaceChildren();
  for (const metric of metrics) appendMetric(container, ...metric);
}

function stateLabel(value) {
  return {
    sin_iniciar: 'SIN INICIAR',
    en_proceso: 'EN PROCESO',
    finalizada: 'FINALIZADA',
    open: 'EN PROCESO',
    closed: 'FINALIZADA',
    cancelled: 'CANCELADA',
  }[value] || String(value || '').toUpperCase();
}


const dashboardNumberFormat = new Intl.NumberFormat(
  'es-CL',
);

function dashboardNumber(value) {
  return dashboardNumberFormat.format(
    number(value),
  );
}

function dashboardPercent(part, total) {
  const numerator = number(part);
  const denominator = number(total);

  if (denominator <= 0) return 0;

  return Math.round(
    (numerator / denominator) * 1000,
  ) / 10;
}

function appendDashboardKpi(
  container,
  {
    label,
    value,
    meta,
    tone = 'neutral',
  },
) {
  const card = document.createElement('article');
  card.className =
    `dashboard-kpi dashboard-kpi--${tone}`;

  const heading = document.createElement('span');
  heading.className = 'dashboard-kpi__label';
  heading.textContent = label;

  const strong = document.createElement('strong');
  strong.className = 'dashboard-kpi__value';
  strong.textContent = value;

  const detail = document.createElement('small');
  detail.className = 'dashboard-kpi__meta';
  detail.textContent = meta;

  card.append(
    heading,
    strong,
    detail,
  );

  container.append(card);
}

function appendDashboardSummary(
  container,
  label,
  value,
  detail,
  tone = 'neutral',
) {
  const item = document.createElement('article');
  item.className =
    `dashboard-summary__item dashboard-summary__item--${tone}`;

  const copy = document.createElement('div');

  const heading = document.createElement('span');
  heading.textContent = label;

  const small = document.createElement('small');
  small.textContent = detail;

  copy.append(
    heading,
    small,
  );

  const strong = document.createElement('strong');
  strong.textContent = value;

  item.append(
    copy,
    strong,
  );

  container.append(item);
}

function renderDashboardDirections(directions) {
  elements.dashboardDirections.replaceChildren();

  for (const direction of directions) {
    const metrics = direction.metrics || {};
    const progress = Math.max(
      0,
      Math.min(
        100,
        number(metrics.porcentajeRevision),
      ),
    );

    const row = document.createElement('article');
    row.className = 'dashboard-direction';

    const top = document.createElement('div');
    top.className = 'dashboard-direction__top';

    const name = document.createElement('strong');
    name.textContent =
      direction.name || 'Sin direcci\u00f3n';

    const percent = document.createElement('span');
    percent.textContent = `${progress}%`;

    top.append(
      name,
      percent,
    );

    const track = document.createElement('div');
    track.className = 'dashboard-direction__track';

    const fill = document.createElement('span');
    fill.style.width = `${progress}%`;

    track.append(fill);

    const detail = document.createElement('small');

    detail.textContent =
      `${number(metrics.finalizadas)} de `
      + `${number(metrics.sections)} secciones `
      + `finalizadas`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'dashboard-direction__open secondary';
    button.textContent = 'Explorar';

    button.addEventListener(
      'click',
      () => openExplorerDirection(
        direction.name,
      ),
    );

    row.append(
      top,
      track,
      detail,
      button,
    );

    elements.dashboardDirections.append(row);
  }

  if (directions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-report';
    empty.textContent =
      'No existen direcciones para mostrar.';

    elements.dashboardDirections.append(empty);
  }
}

function renderDashboard(overview) {
  if (!overview) return;

  const metrics = overview.overall || {};

  const expected =
    number(metrics.bienesEsperados);

  const reviewed =
    number(metrics.bienesEsperadosRevisados);

  const conforming =
    number(metrics.bienesConformes);

  const incidences =
    number(metrics.incidencias);

  const pending =
    number(metrics.pendientes);

  const findings =
    number(metrics.noRegistrados);

  const reviewPercent =
    number(metrics.porcentajeRevision);

  const conformityPercent =
    dashboardPercent(
      conforming,
      reviewed,
    );

  const incidencePercent =
    dashboardPercent(
      incidences,
      reviewed,
    );

  const pendingPercent =
    dashboardPercent(
      pending,
      expected,
    );

  elements.dashboardKpis.replaceChildren();

  const kpis = [
    {
      label: 'Bienes esperados',
      value: dashboardNumber(expected),
      meta: 'Seg\u00fan inventario maestro',
      tone: 'neutral',
    },
    {
      label: 'Revisados',
      value: dashboardNumber(reviewed),
      meta: `${reviewPercent}% del universo esperado`,
      tone: 'info',
    },
    {
      label: 'Conformes',
      value: dashboardNumber(conforming),
      meta: `${conformityPercent}% de los revisados`,
      tone: 'success',
    },
    {
      label: 'Con incidencia',
      value: dashboardNumber(incidences),
      meta: `${incidencePercent}% de los revisados`,
      tone: 'warning',
    },
    {
      label: 'Pendientes',
      value: dashboardNumber(pending),
      meta: `${pendingPercent}% por revisar`,
      tone: 'neutral',
    },
    {
      label: 'Hallazgos adicionales',
      value: dashboardNumber(findings),
      meta: 'No registrados en el maestro',
      tone: 'finding',
    },
  ];

  for (const kpi of kpis) {
    appendDashboardKpi(
      elements.dashboardKpis,
      kpi,
    );
  }

  renderDashboardDirections(
    overview.directions || [],
  );

  const directions =
    overview.directions || [];

  const sectionCount =
    directions.reduce(
      (sum, direction) =>
        sum + number(direction.metrics?.sections),
      0,
    );

  const completedSections =
    directions.reduce(
      (sum, direction) =>
        sum + number(direction.metrics?.finalizadas),
      0,
    );

  const closedPercent =
    dashboardPercent(
      completedSections,
      sectionCount,
    );

  elements.dashboardSummary.replaceChildren();

  appendDashboardSummary(
    elements.dashboardSummary,
    'Cobertura',
    `${reviewPercent}%`,
    `${dashboardNumber(reviewed)} de `
      + `${dashboardNumber(expected)} esperados`,
    reviewPercent >= 100
      ? 'success'
      : 'info',
  );

  appendDashboardSummary(
    elements.dashboardSummary,
    'Conformidad',
    `${conformityPercent}%`,
    `${dashboardNumber(conforming)} bienes conformes`,
    conformityPercent >= 90
      ? 'success'
      : 'warning',
  );

  appendDashboardSummary(
    elements.dashboardSummary,
    'Secciones finalizadas',
    `${closedPercent}%`,
    `${completedSections} de ${sectionCount}`,
    closedPercent >= 100
      ? 'success'
      : 'info',
  );

  appendDashboardSummary(
    elements.dashboardSummary,
    'Incidencias vigentes',
    dashboardNumber(incidences),
    'Requieren seguimiento o conciliaci\u00f3n',
    incidences > 0
      ? 'warning'
      : 'success',
  );

  appendDashboardSummary(
    elements.dashboardSummary,
    'Requieren revisi\u00f3n',
    dashboardNumber(
      metrics.pendientesRevision,
    ),
    'Pendientes de an\u00e1lisis posterior',
    number(metrics.pendientesRevision) > 0
      ? 'warning'
      : 'success',
  );

  appendDashboardSummary(
    elements.dashboardSummary,
    'Propuestas de baja',
    dashboardNumber(
      metrics.propuestasBaja,
    ),
    'Propuestas, no bajas administrativas',
    number(metrics.propuestasBaja) > 0
      ? 'warning'
      : 'neutral',
  );

  elements.dashboardLastSync.textContent =
    `Actualizado: ${dateTime(overview.generatedAt)}`;

  elements.dashboardLive.dataset.state = 'online';
  elements.dashboardLive.querySelector(
    'strong',
  ).textContent = 'Sistema en l\u00ednea';
}


function allOverviewSections(overview) {
  return (overview?.directions || []).flatMap(
    (direction) =>
      (direction.departments || []).flatMap(
        (department) =>
          (department.sections || []).map(
            (section) => ({
              ...section,
              directionName: direction.name,
              departmentName: department.name,
            }),
          ),
      ),
  );
}

function uniqueSorted(values) {
  return [...new Set(
    values.filter(Boolean),
  )].sort(
    (a, b) => a.localeCompare(
      b,
      'es',
      { sensitivity: 'base' },
    ),
  );
}

function setExplorerOptions(
  select,
  values,
  selectedValue = '',
) {
  select.replaceChildren();

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Seleccione\u2026';
  select.append(blank);

  for (const value of values) {
    const option = document.createElement('option');
    option.value = String(value.value ?? value);
    option.textContent =
      value.label ?? String(value);

    select.append(option);
  }

  if (
    selectedValue
    && [...select.options].some(
      ({ value }) =>
        value === String(selectedValue),
    )
  ) {
    select.value = String(selectedValue);
  }
}

function refreshExplorerFilters(overview) {
  const sections = allOverviewSections(overview);

  const currentDirection =
    elements.explorerDirection.value;

  const currentDepartment =
    elements.explorerDepartment.value;

  const currentLocation =
    elements.explorerSection.value;

  const directions = uniqueSorted(
    sections.map(
      ({ directionName }) => directionName,
    ),
  );

  setExplorerOptions(
    elements.explorerDirection,
    directions,
    currentDirection,
  );

  const selectedDirection =
    elements.explorerDirection.value;

  const departments = uniqueSorted(
    sections
      .filter(
        ({ directionName }) =>
          directionName === selectedDirection,
      )
      .map(
        ({ departmentName }) => departmentName,
      ),
  );

  setExplorerOptions(
    elements.explorerDepartment,
    departments,
    currentDepartment,
  );

  elements.explorerDepartment.disabled =
    !selectedDirection;

  const selectedDepartment =
    elements.explorerDepartment.value;

  const sectionOptions = sections
    .filter(
      (section) =>
        section.directionName === selectedDirection
        && section.departmentName === selectedDepartment,
    )
    .map(
      (section) => ({
        value: section.locationId,
        label: section.section || 'Seccion sin nombre',
      }),
    )
    .sort(
      (a, b) =>
        a.label.localeCompare(
          b.label,
          'es',
          { sensitivity: 'base' },
        ),
    );

  setExplorerOptions(
    elements.explorerSection,
    sectionOptions,
    currentLocation,
  );

  elements.explorerSection.disabled =
    !selectedDepartment;
}

function selectedOverviewSection() {
  const locationId =
    number(elements.explorerSection.value);

  if (!locationId) return null;

  return allOverviewSections(
    state.overview,
  ).find(
    (section) =>
      number(section.locationId) === locationId,
  ) || null;
}

function observationStateLabel(observation) {
  if (!observation) return 'Pendiente';

  return {
    verificado: 'Conforme',
    dato_distinto: 'Con incidencia',
    otra_ubicacion: 'Otra ubicacion',
    no_ubicado: 'No encontrado',
    desconocido: 'Hallazgo adicional',
  }[observation.status]
    || observation.status
    || 'Registrado';
}

function observationTone(observation) {
  if (!observation) return 'pending';

  if (observation.status === 'verificado') {
    return 'success';
  }

  if (observation.status === 'no_ubicado') {
    return 'danger';
  }

  return 'warning';
}

function renderExplorerMetrics(section) {
  elements.explorerMetrics.replaceChildren();

  const metrics = [
    {
      label: 'Esperados',
      value: dashboardNumber(
        section.bienesEsperados,
      ),
      meta: 'Segun maestro',
      tone: 'neutral',
    },
    {
      label: 'Revisados',
      value: dashboardNumber(
        section.bienesEsperadosRevisados,
      ),
      meta: `${number(section.porcentajeRevision)}%`,
      tone: 'info',
    },
    {
      label: 'Conformes',
      value: dashboardNumber(
        section.bienesConformes,
      ),
      meta: 'Coinciden con el maestro',
      tone: 'success',
    },
    {
      label: 'Con incidencia',
      value: dashboardNumber(
        section.incidencias,
      ),
      meta: 'Observaciones vigentes',
      tone: 'warning',
    },
    {
      label: 'Pendientes',
      value: dashboardNumber(
        section.pendientes,
      ),
      meta: 'Aun no revisados',
      tone: 'neutral',
    },
    {
      label: 'Hallazgos adicionales',
      value: dashboardNumber(
        section.noRegistrados,
      ),
      meta: 'Fuera del maestro',
      tone: 'finding',
    },
  ];

  for (const metric of metrics) {
    appendDashboardKpi(
      elements.explorerMetrics,
      metric,
    );
  }
}

function createExplorerStateBadge(
  label,
  tone,
) {
  const badge = document.createElement('span');

  badge.className =
    `explorer-state explorer-state--${tone}`;

  badge.textContent = label;

  return badge;
}


function explorerOutcome(observation) {
  const definitions = {
    verificado: {
      label: 'Conforme',
      tone: 'success',
      color: 'var(--success)',
    },
    dato_distinto: {
      label: 'Datos distintos',
      tone: 'warning',
      color: '#d18b27',
    },
    otra_ubicacion: {
      label: 'Otra ubicacion',
      tone: 'info',
      color: 'var(--info)',
    },
    no_ubicado: {
      label: 'No encontrado',
      tone: 'danger',
      color: 'var(--danger)',
    },
    desconocido: {
      label: 'Hallazgo adicional',
      tone: 'finding',
      color: '#7561a8',
    },
  };

  return definitions[
    observation?.status
  ] || {
    label: 'Otro',
    tone: 'neutral',
    color: '#a7aaa3',
  };
}


function countIncidenceFlag(
  incidences,
  flag,
) {
  return incidences.filter(
    (incidence) =>
      Boolean(incidence.flags?.[flag]),
  ).length;
}

function appendIncidenceMetric(
  container,
  label,
  count,
  total,
  tone = 'neutral',
) {
  const row = document.createElement('article');

  row.className =
    `explorer-incidence-metric `
    + `explorer-incidence-metric--${tone}`;

  const copy = document.createElement('div');

  const name = document.createElement('span');
  name.textContent = label;

  const detail = document.createElement('small');

  const percent =
    total > 0
      ? Math.round((count / total) * 100)
      : 0;

  detail.textContent =
    `${percent}% de las incidencias`;

  copy.append(
    name,
    detail,
  );

  const strong = document.createElement('strong');
  strong.textContent = String(count);

  row.append(
    copy,
    strong,
  );

  container.append(row);
}

function renderExplorerIncidenceMatrix(report) {
  elements.explorerIncidenceMatrix.replaceChildren();

  const incidences =
    report?.incidences || [];

  const total = incidences.length;

  const metrics = [
    [
      'Sin etiqueta',
      'sin_etiqueta',
      'warning',
    ],
    [
      'Datos no coinciden',
      'datos_no_coinciden',
      'warning',
    ],
    [
      'Otra ubicacion',
      'otra_ubicacion',
      'info',
    ],
    [
      'Bien no registrado',
      'bien_no_registrado',
      'finding',
    ],
    [
      'No operativo',
      'no_operativo',
      'danger',
    ],
    [
      'Estado malo',
      'malo',
      'danger',
    ],
    [
      'Propuesta de baja',
      'propuesta_baja',
      'danger',
    ],
    [
      'Pendiente identificar',
      'pendiente_identificar',
      'warning',
    ],
    [
      'Requiere revision',
      'requiere_revision',
      'warning',
    ],
    [
      'Con fotografia',
      'con_fotografia',
      'success',
    ],
  ];

  for (const [
    label,
    flag,
    tone,
  ] of metrics) {
    appendIncidenceMetric(
      elements.explorerIncidenceMatrix,
      label,
      countIncidenceFlag(
        incidences,
        flag,
      ),
      total,
      tone,
    );
  }

  if (total === 0) {
    const empty = document.createElement('p');

    empty.className = 'empty-report';

    empty.textContent =
      'No existen incidencias vigentes en esta seccion.';

    elements.explorerIncidenceMatrix.append(empty);
  }

  renderExplorerIntegrity(report);
}

function renderExplorerIntegrity(report) {
  elements.explorerIntegritySummary.replaceChildren();

  const incidences =
    report?.incidences || [];

  const withEvidence =
    incidences.filter(
      ({ evidenceCount }) =>
        number(evidenceCount) > 0,
    ).length;

  const unavailable =
    incidences.filter(
      ({ evidenceComplete }) =>
        evidenceComplete === false,
    ).length;

  const corrections =
    number(report?.corrections);

  const annulments =
    number(report?.annulments);

  const metrics = [
    [
      'Incidencias vigentes',
      incidences.length,
      'Estado actual',
    ],
    [
      'Con evidencia',
      withEvidence,
      incidences.length
        ? `${Math.round(
          (withEvidence / incidences.length) * 100,
        )}%`
        : '0%',
    ],
    [
      'Evidencia no disponible',
      unavailable,
      unavailable
        ? 'Requiere revision'
        : 'Sin alertas',
    ],
    [
      'Correcciones auditadas',
      corrections,
      'Historial conservado',
    ],
    [
      'Anulaciones auditadas',
      annulments,
      'No cuentan como bienes vigentes',
    ],
  ];

  for (const [
    label,
    value,
    detail,
  ] of metrics) {
    const row = document.createElement('article');
    row.className = 'explorer-integrity-item';

    const copy = document.createElement('div');

    const title = document.createElement('span');
    title.textContent = label;

    const small = document.createElement('small');
    small.textContent = detail;

    copy.append(
      title,
      small,
    );

    const strong = document.createElement('strong');
    strong.textContent = String(value);

    row.append(
      copy,
      strong,
    );

    elements.explorerIntegritySummary.append(row);
  }
}

function physicalEvidenceFor(
  observation,
  report,
) {
  if (!observation) return [];

  const incidence = (
    report?.incidences || []
  ).find(
    (item) =>
      number(item.id)
      === number(observation.id),
  );

  return incidence?.evidence || [];
}

function renderExplorerPhysical(
  assets,
  observations,
  report,
) {
  elements.explorerPhysical.replaceChildren();

  const byAsset = new Map(
    observations
      .filter(({ assetId }) => assetId)
      .map(
        (observation) => [
          number(observation.assetId),
          observation,
        ],
      ),
  );

  const cards = [];

  for (const asset of assets) {
    cards.push({
      kind: 'expected',
      asset,
      observation:
        byAsset.get(number(asset.id)) || null,
    });
  }

  for (const observation of observations) {
    if (observation.assetId) continue;

    cards.push({
      kind: 'finding',
      asset: null,
      observation,
    });
  }

  elements.explorerPhysicalCount.textContent =
    String(cards.length);

  for (const item of cards) {
    const card = document.createElement('article');

    card.className =
      `physical-card physical-card--${item.kind}`;

    const observation =
      item.observation;

    const evidence =
      physicalEvidenceFor(
        observation,
        report,
      );

    const imageArea = document.createElement('div');
    imageArea.className = 'physical-card__image';

    if (evidence.length > 0) {
      const image = document.createElement('img');

      image.src = evidence[0].url;
      image.alt =
        item.asset?.name
        || observation?.details?.provisional?.description
        || 'Bien registrado';

      image.loading = 'lazy';

      imageArea.append(image);

    } else {
      const placeholder =
        document.createElement('div');

      placeholder.className =
        'physical-card__placeholder';

      placeholder.textContent =
        observation
          ? 'Sin fotografia requerida o disponible'
          : 'Pendiente de inspeccion';

      imageArea.append(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'physical-card__body';

    const code = document.createElement('span');
    code.className = 'physical-card__code';

    code.textContent =
      item.asset?.assetCode
      || observation?.provisionalCode
      || 'Sin codigo';

    const heading = document.createElement('strong');

    heading.textContent =
      item.asset?.name
      || observation?.details?.provisional?.description
      || 'Bien fisico no registrado';

    const state = createExplorerStateBadge(
      observationStateLabel(observation),
      observationTone(observation),
    );

    const meta = document.createElement('small');

    meta.textContent =
      observation
        ? (
          `${fieldConditionLabel(
            observation.details?.physicalCondition,
          )} ? `
          + functionalityLabel(
            observation.details?.functionality,
          )
        )
        : 'Sin inspeccion de terreno';

    body.append(
      code,
      heading,
      state,
      meta,
    );

    if (item.asset) {
      const button =
        document.createElement('button');

      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Ver ficha';

      button.addEventListener(
        'click',
        () => openAssetDossier(
          item.asset,
          observation,
        ),
      );

      body.append(button);

    } else {
      const incidence = (
        report?.incidences || []
      ).find(
        ({ id }) =>
          number(id)
          === number(observation.id),
      );

      if (incidence) {
        const button =
          document.createElement('button');

        button.type = 'button';
        button.className = 'secondary';
        button.textContent = 'Ver hallazgo';

        button.addEventListener(
          'click',
          () => openIncidence(
            incidence.id,
            state.explorerSessionId,
          ),
        );

        body.append(button);
      }
    }

    card.append(
      imageArea,
      body,
    );

    elements.explorerPhysical.append(card);
  }

  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-report';
    empty.textContent =
      'Esta seccion no contiene bienes para mostrar.';

    elements.explorerPhysical.append(empty);
  }
}

function appendSummaryMetric(
  container,
  label,
  value,
) {
  const item = document.createElement('div');

  const span = document.createElement('span');
  span.textContent = label;

  const strong = document.createElement('strong');
  strong.textContent = value;

  item.append(
    span,
    strong,
  );

  container.append(item);
}

function renderExplorerSummary(
  section,
  observations,
  report,
) {
  elements.explorerSummarySheet.replaceChildren();

  if (!section) return;

  const title = document.createElement('div');
  title.className = 'section-summary__title';

  const kicker = document.createElement('span');
  kicker.textContent =
    'INVENTARIO FISICO MUNICIPAL';

  const heading = document.createElement('h3');
  heading.textContent =
    section.section || 'Seccion';

  const location = document.createElement('p');

  location.textContent =
    `${section.directionName} / `
    + `${section.departmentName}`;

  title.append(
    kicker,
    heading,
    location,
  );

  const metrics = document.createElement('div');
  metrics.className = 'section-summary__metrics';

  for (const [
    label,
    value,
  ] of [
    [
      'Esperados',
      dashboardNumber(
        section.bienesEsperados,
      ),
    ],
    [
      'Revisados',
      dashboardNumber(
        section.bienesEsperadosRevisados,
      ),
    ],
    [
      'Conformes',
      dashboardNumber(
        section.bienesConformes,
      ),
    ],
    [
      'Incidencias',
      dashboardNumber(
        section.incidencias,
      ),
    ],
    [
      'Pendientes',
      dashboardNumber(
        section.pendientes,
      ),
    ],
    [
      'Hallazgos adicionales',
      dashboardNumber(
        section.noRegistrados,
      ),
    ],
  ]) {
    appendSummaryMetric(
      metrics,
      label,
      value,
    );
  }

  const text = document.createElement('div');
  text.className = 'section-summary__text';

  const coverage = document.createElement('p');

  coverage.textContent =
    `Cobertura del levantamiento: `
    + `${number(section.porcentajeRevision)}%.`;

  const current = document.createElement('p');

  current.textContent =
    `Registros vigentes de terreno: `
    + `${observations.length}.`;

  const evidenceCount = (
    report?.incidences || []
  ).reduce(
    (sum, incidence) =>
      sum + number(incidence.evidenceCount),
    0,
  );

  const evidence = document.createElement('p');

  evidence.textContent =
    `Evidencias fotograficas vigentes: `
    + `${evidenceCount}.`;

  const disclaimer = document.createElement('p');

  disclaimer.className =
    'report-disclaimer';

  disclaimer.textContent =
    'Los hallazgos e incidencias describen lo observado '
    + 'en terreno. Este resumen no modifica por si solo '
    + 'el inventario maestro ni constituye regularizacion '
    + 'administrativa.';

  text.append(
    coverage,
    current,
    evidence,
    disclaimer,
  );

  const cutoff = document.createElement('small');

  cutoff.className = 'section-summary__cutoff';

  cutoff.textContent =
    `Corte: ${dateTime(
      report?.generatedAt
      || state.overview?.generatedAt,
    )}`;

  elements.explorerSummarySheet.append(
    title,
    metrics,
    text,
    cutoff,
  );
}

function renderExplorerAnalytics(
  observations,
) {
  const groups = new Map();

  for (const observation of observations) {
    const outcome =
      explorerOutcome(observation);

    if (!groups.has(outcome.label)) {
      groups.set(
        outcome.label,
        {
          ...outcome,
          count: 0,
        },
      );
    }

    groups.get(outcome.label).count += 1;
  }

  const values = [
    ...groups.values(),
  ];

  const total = observations.length;

  elements.explorerDonutTotal.textContent =
    String(total);

  elements.explorerOutcomeLegend.replaceChildren();

  if (total === 0) {
    elements.explorerDonut.style.background =
      '#e4e5e0';

    const empty = document.createElement('p');
    empty.className = 'empty-report';
    empty.textContent =
      'Aun no hay registros de terreno.';

    elements.explorerOutcomeLegend.append(empty);

  } else {
    let start = 0;
    const segments = [];

    for (const value of values) {
      const percent =
        (value.count / total) * 100;

      const end = start + percent;

      segments.push(
        `${value.color} ${start}% ${end}%`,
      );

      start = end;
    }

    elements.explorerDonut.style.background =
      `conic-gradient(${segments.join(', ')})`;

    for (const value of values) {
      const row = document.createElement('div');
      row.className =
        'explorer-outcome-legend__row';

      const label = document.createElement('span');

      const dot = document.createElement('i');
      dot.style.background = value.color;

      const text = document.createElement('span');
      text.textContent = value.label;

      label.append(
        dot,
        text,
      );

      const count = document.createElement('strong');

      const percent = Math.round(
        (value.count / total) * 100,
      );

      count.textContent =
        `${value.count} (${percent}%)`;

      row.append(
        label,
        count,
      );

      elements.explorerOutcomeLegend.append(row);
    }
  }

  renderExplorerRecent(observations);
}

function renderExplorerRecent(observations) {
  elements.explorerRecent.replaceChildren();

  const recent = [...observations]
    .sort(
      (a, b) =>
        Date.parse(b.observedAt || 0)
        - Date.parse(a.observedAt || 0),
    )
    .slice(0, 6);

  for (const observation of recent) {
    const row = document.createElement('article');
    row.className = 'explorer-recent__item';

    const status =
      explorerOutcome(observation);

    const badge = document.createElement('span');
    badge.className =
      `explorer-recent__dot explorer-recent__dot--${status.tone}`;

    const body = document.createElement('div');

    const code = document.createElement('strong');

    code.textContent =
      observation.assetCode
      || observation.provisionalCode
      || 'Sin codigo';

    const name = document.createElement('span');

    name.textContent =
      observation.assetName
      || observation.details?.provisional?.description
      || 'Bien fisico';

    const meta = document.createElement('small');

    meta.textContent =
      `${status.label} ? ${dateTime(observation.observedAt)}`;

    body.append(
      code,
      name,
      meta,
    );

    row.append(
      badge,
      body,
    );

    elements.explorerRecent.append(row);
  }

  if (recent.length === 0) {
    const empty = document.createElement('p');

    empty.className = 'empty-report';

    empty.textContent =
      'Sin actividad registrada en esta seccion.';

    elements.explorerRecent.append(empty);
  }
}

function fieldConditionLabel(value) {
  return {
    bueno: 'Bueno',
    regular: 'Regular',
    malo: 'Malo',
    incompleto: 'Incompleto',
  }[value] || value || '\u2014';
}

function functionalityLabel(value) {
  return {
    operativo: 'Operativo',
    operativo_con_falla: 'Operativo con falla',
    no_operativo: 'No operativo',
    no_verificable: 'No verificable',
  }[value] || value || '\u2014';
}

function findIncidenceForObservation(
  observation,
) {
  if (!observation) return null;

  return (
    state.explorerReport?.incidences || []
  ).find(
    (incidence) =>
      number(incidence.id)
      === number(observation.id),
  ) || null;
}

function openAssetDossier(
  asset,
  observation,
) {
  elements.assetDialogContent.replaceChildren();

  elements.assetDialogTitle.textContent =
    asset.name || 'Bien del inventario';

  elements.assetDialogSubtitle.textContent =
    asset.assetCode || 'SIN CODIGO';

  const masterTitle = document.createElement('h3');
  masterTitle.textContent =
    'Registro maestro';

  const master = document.createElement('dl');
  master.className = 'report-detail-grid';

  appendDefinition(
    master,
    'Codigo patrimonial',
    asset.assetCode || '\u2014',
  );

  appendDefinition(
    master,
    'Codigo escaner',
    asset.scannerCode || '\u2014',
  );

  appendDefinition(
    master,
    'Bien',
    asset.name || '\u2014',
  );

  appendDefinition(
    master,
    'Marca',
    asset.brand || '\u2014',
  );

  appendDefinition(
    master,
    'Modelo',
    asset.model || '\u2014',
  );

  appendDefinition(
    master,
    'Serie',
    asset.serialNumber || '\u2014',
  );

  appendDefinition(
    master,
    'Ubicacion registrada',
    locationText(asset),
  );

  elements.assetDialogContent.append(
    masterTitle,
    master,
  );

  const fieldTitle = document.createElement('h3');
  fieldTitle.textContent =
    'Resultado del levantamiento';

  const field = document.createElement('dl');
  field.className = 'report-detail-grid';

  if (!observation) {
    appendDefinition(
      field,
      'Estado',
      'Pendiente de revisar',
    );

    appendDefinition(
      field,
      'Observacion en terreno',
      'Aun no existe una observacion vigente.',
    );

  } else {
    appendDefinition(
      field,
      'Estado',
      observationStateLabel(observation),
    );

    appendDefinition(
      field,
      'Fecha / hora',
      dateTime(observation.observedAt),
    );

    appendDefinition(
      field,
      'Conservacion',
      fieldConditionLabel(
        observation.details?.physicalCondition,
      ),
    );

    appendDefinition(
      field,
      'Funcionamiento',
      functionalityLabel(
        observation.details?.functionality,
      ),
    );

    appendDefinition(
      field,
      'Version',
      String(
        observation.versionNumber || 1,
      ),
    );
  }

  elements.assetDialogContent.append(
    fieldTitle,
    field,
  );

  const incidence =
    findIncidenceForObservation(
      observation,
    );

  if (incidence) {
    const actions = document.createElement('div');
    actions.className = 'asset-dossier__actions';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent =
      'Ver incidencia y evidencia';

    button.addEventListener(
      'click',
      () => {
        elements.assetDialog.close();

        openIncidence(
          incidence.id,
          state.explorerSessionId,
        );
      },
    );

    actions.append(button);
    elements.assetDialogContent.append(actions);
  }

  elements.assetDialog.showModal();
}

function renderExplorerAssets(
  assets,
  observations,
) {
  elements.explorerAssets.replaceChildren();

  const query =
    state.explorerQuery
      .trim()
      .toLocaleLowerCase('es');

  const byAsset = new Map(
    observations
      .filter(({ assetId }) => assetId)
      .map(
        (observation) => [
          number(observation.assetId),
          observation,
        ],
      ),
  );

  const filtered = assets.filter(
    (asset) => {
      if (!query) return true;

      const observation =
        byAsset.get(number(asset.id));

      const searchable = [
        asset.assetCode,
        asset.scannerCode,
        asset.name,
        asset.brand,
        asset.model,
        observationStateLabel(observation),
        observation?.details?.physicalCondition,
        observation?.details?.functionality,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('es');

      return searchable.includes(query);
    },
  );

  elements.explorerExpectedCount.textContent =
    String(assets.length);

  elements.explorerAssetsShown.textContent =
    query
      ? `${filtered.length} de ${assets.length}`
      : `${assets.length} bienes`;

  const header = document.createElement('div');

  header.className =
    'explorer-row explorer-row--header';

  for (const label of [
    'Codigo',
    'Bien',
    'Estado',
    'Condicion',
    '',
  ]) {
    const cell = document.createElement('span');
    cell.textContent = label;
    header.append(cell);
  }

  elements.explorerAssets.append(header);

  for (const asset of filtered) {
    const observation =
      byAsset.get(number(asset.id));

    const row = document.createElement('article');
    row.className = 'explorer-row';

    const code = document.createElement('strong');

    code.textContent =
      asset.assetCode || 'Sin codigo';

    const name = document.createElement('span');

    name.textContent =
      asset.name || 'Bien sin descripcion';

    const status = createExplorerStateBadge(
      observationStateLabel(observation),
      observationTone(observation),
    );

    const condition = document.createElement('span');

    condition.textContent =
      observation
        ? fieldConditionLabel(
          observation.details?.physicalCondition,
        )
        : '\u2014';

    const button = document.createElement('button');

    button.type = 'button';
    button.className =
      'secondary explorer-row__detail';

    button.textContent = 'Ver ficha';

    button.addEventListener(
      'click',
      () => openAssetDossier(
        asset,
        observation,
      ),
    );

    row.append(
      code,
      name,
      status,
      condition,
      button,
    );

    elements.explorerAssets.append(row);
  }

  if (filtered.length === 0) {
    const empty = document.createElement('p');

    empty.className = 'empty-report';

    empty.textContent =
      query
        ? 'No hay bienes que coincidan con la busqueda.'
        : 'La seccion no tiene bienes esperados en el maestro.';

    elements.explorerAssets.append(empty);
  }
}

function renderExplorerFindings(
  observations,
  report,
  sessionId,
) {
  elements.explorerFindings.replaceChildren();

  const findings = observations.filter(
    ({ assetId }) => !assetId,
  );

  elements.explorerFindingsCount.textContent =
    String(findings.length);

  const incidenceById = new Map(
    (report?.incidences || []).map(
      (incidence) => [
        number(incidence.id),
        incidence,
      ],
    ),
  );

  for (const finding of findings) {
    const incidence =
      incidenceById.get(number(finding.id));

    const card = document.createElement('article');
    card.className = 'explorer-finding';

    const body = document.createElement('div');

    const eyebrow = document.createElement('span');
    eyebrow.className = 'explorer-finding__code';
    eyebrow.textContent =
      finding.provisionalCode
      || 'Hallazgo provisional';

    const heading = document.createElement('strong');
    heading.textContent =
      finding.details?.provisional?.description
      || 'Bien fisico no registrado';

    const meta = document.createElement('small');

    const physicalCondition =
      finding.details?.physicalCondition
      || 'Sin condicion registrada';

    const functionality =
      finding.details?.functionality
      || 'Sin funcionamiento registrado';

    meta.textContent =
      `${physicalCondition} ? ${functionality}`;

    body.append(
      eyebrow,
      heading,
      meta,
    );

    const actions = document.createElement('div');
    actions.className =
      'explorer-finding__actions';

    const badge = createExplorerStateBadge(
      observationStateLabel(finding),
      'warning',
    );

    actions.append(badge);

    if (incidence) {
      const button =
        document.createElement('button');

      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Ver ficha';

      button.addEventListener(
        'click',
        () => openIncidence(
          incidence.id,
          sessionId,
        ),
      );

      actions.append(button);
    }

    card.append(
      body,
      actions,
    );

    elements.explorerFindings.append(card);
  }

  if (findings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-report';
    empty.textContent =
      'No hay hallazgos adicionales vigentes en esta seccion.';

    elements.explorerFindings.append(empty);
  }
}

function openExplorerEvidence(evidence) {
  elements.photoFull.src = evidence.url;
  elements.photoFull.alt =
    `Evidencia ampliada: ${evidence.typeLabel}`;

  elements.photoType.textContent =
    evidence.typeLabel;

  elements.photoDialog.showModal();
}

function renderExplorerEvidence(
  report,
) {
  elements.explorerEvidence.replaceChildren();

  const items = (
    report?.incidences || []
  ).flatMap(
    (incidence) =>
      (incidence.evidence || []).map(
        (evidence) => ({
          ...evidence,
          incidence,
        }),
      ),
  );

  elements.explorerEvidenceCount.textContent =
    String(items.length);

  for (const item of items) {
    const figure = document.createElement('figure');
    figure.className =
      'explorer-evidence__item';

    const image = document.createElement('img');

    image.src = item.url;
    image.alt =
      `Evidencia de ${item.incidence.displayCode}`;
    image.loading = 'lazy';

    const caption = document.createElement('figcaption');

    const code = document.createElement('strong');
    code.textContent =
      item.incidence.displayCode;

    const name = document.createElement('span');
    name.textContent =
      item.incidence.assetName;

    const type = document.createElement('small');
    type.textContent =
      item.available === false
        ? `${item.typeLabel} ? NO DISPONIBLE`
        : item.typeLabel;

    caption.append(
      code,
      name,
      type,
    );

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ampliar';
    button.disabled =
      item.available === false;

    button.addEventListener(
      'click',
      () => openExplorerEvidence(item),
    );

    figure.append(
      image,
      caption,
      button,
    );

    elements.explorerEvidence.append(figure);
  }

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-report';
    empty.textContent =
      'No hay fotografias vigentes para mostrar.';

    elements.explorerEvidence.append(empty);
  }
}

function setExplorerTab(tab) {
  state.explorerTab = tab;

  document.querySelectorAll(
    '[data-explorer-tab]',
  ).forEach(
    (button) => {
      const active =
        button.dataset.explorerTab === tab;

      button.setAttribute(
        'aria-pressed',
        String(active),
      );
    },
  );

  document.querySelectorAll(
    '[data-explorer-panel]',
  ).forEach(
    (panel) => {
      panel.hidden =
        panel.dataset.explorerPanel !== tab;
    },
  );
}

async function refreshExplorerSection({
  silent = false,
} = {}) {
  if (
    state.explorerRefreshing
    || !state.explorerLocationId
  ) return;

  const section =
    allOverviewSections(
      state.overview,
    ).find(
      ({ locationId }) =>
        number(locationId)
        === number(state.explorerLocationId),
    );

  if (!section) return;

  state.explorerRefreshing = true;

  if (!silent) {
    elements.explorerStatus.textContent =
      'Actualizando seccion\u2026';
  }

  try {
    let assets = [];
    let observations = [];
    let report = null;

    if (section.sessionId) {
      const [
        assetsResult,
        observationsResult,
        reportResult,
      ] = await Promise.all([
        api(
          `/api/assets?locationId=${section.locationId}`,
        ),
        api(
          `/api/sessions/${section.sessionId}/observations`,
        ),
        api(
          `/api/sessions/${section.sessionId}/report`,
        ),
      ]);

      assets =
        assetsResult.assets || [];

      observations =
        observationsResult.observations || [];

      report =
        reportResult.report || null;

    } else {
      const assetsResult = await api(
        `/api/assets?locationId=${section.locationId}`,
      );

      assets =
        assetsResult.assets || [];
    }

    state.explorerSessionId =
      section.sessionId || null;

    state.explorerSection = section;
    state.explorerAssets = assets;
    state.explorerObservations =
      observations;
    state.explorerReport = report;

    renderExplorerMetrics(section);

    renderExplorerAssets(
      assets,
      observations,
    );

    renderExplorerFindings(
      observations,
      report,
      section.sessionId,
    );

    renderExplorerEvidence(report);

    renderExplorerAnalytics(
      observations,
    );

    renderExplorerIncidenceMatrix(
      report,
    );

    renderExplorerPhysical(
      assets,
      observations,
      report,
    );

    renderExplorerSummary(
      section,
      observations,
      report,
    );

    elements.explorerBreadcrumb.textContent =
      `${section.directionName} / `
      + `${section.departmentName} / `
      + `${section.section}`;

    elements.explorerEmpty.hidden = true;
    elements.explorerContent.hidden = false;

    elements.explorerStatus.textContent =
      section.sessionId
        ? (
          section.state === 'finalizada'
            ? 'Seccion finalizada'
            : 'Levantamiento en proceso'
        )
        : 'Seccion no iniciada';

  } catch (error) {
    elements.explorerStatus.textContent =
      'No fue posible actualizar';

    if (!silent) {
      setMessage(
        error.message,
        true,
      );
    }

  } finally {
    state.explorerRefreshing = false;
  }
}

async function selectExplorerSection() {
  const section =
    selectedOverviewSection();

  if (!section) {
    state.explorerLocationId = null;
    state.explorerSessionId = null;

    elements.explorerContent.hidden = true;
    elements.explorerEmpty.hidden = false;
    elements.explorerStatus.textContent =
      'Seleccione una seccion';

    return;
  }

  state.explorerLocationId =
    number(section.locationId);

  await refreshExplorerSection();
}

function openExplorerDirection(directionName) {
  refreshExplorerFilters(
    state.overview,
  );

  elements.explorerDirection.value =
    directionName;

  elements.explorerDirection.dispatchEvent(
    new Event('change'),
  );

  document.querySelector(
    '#dashboard-explorer',
  )?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

async function refreshDashboardOverview() {
  if (state.dashboardRefreshing) return;

  state.dashboardRefreshing = true;

  try {
    const { overview } = await api(
      '/api/reports/overview',
    );

    state.overview = overview;

    renderDashboard(overview);
    renderOverview(overview);
    refreshExplorerFilters(overview);

    if (state.explorerLocationId) {
      await refreshExplorerSection({
        silent: true,
      });
    }

    elements.dashboardLive.dataset.state =
      'online';

  } catch {
    elements.dashboardLive.dataset.state =
      'warning';

    elements.dashboardLive.querySelector(
      'strong',
    ).textContent =
      'Sin actualizaci\u00f3n';

    elements.dashboardLastSync.textContent =
      'Se reintentar\u00e1 autom\u00e1ticamente';

  } finally {
    state.dashboardRefreshing = false;
  }
}

function startDashboardRefresh() {
  if (state.dashboardTimer) return;

  state.dashboardTimer = window.setInterval(
    refreshDashboardOverview,
    5000,
  );
}

function stopDashboardRefresh() {
  if (!state.dashboardTimer) return;

  window.clearInterval(
    state.dashboardTimer,
  );

  state.dashboardTimer = null;
}

function renderOverview(overview) {
  elements.overviewCutoff.textContent = `Corte: ${dateTime(overview.generatedAt)}`;
  const metrics = overview.overall;
  renderMetrics(elements.overviewMetrics, [
    ['Bienes esperados', number(metrics.bienesEsperados)],
    ['Revisados', number(metrics.bienesEsperadosRevisados), 'success'],
    ['Avance', `${number(metrics.porcentajeRevision)}%`, 'success'],
    ['Conformes', number(metrics.bienesConformes)],
    ['Pendientes de verificar', number(metrics.pendientes), 'warning'],
    ['Incidencias', number(metrics.incidencias), 'warning'],
    ['Otra ubicación', number(metrics.diferenciasUbicacion)],
    ['No registrados', number(metrics.noRegistrados), 'danger'],
    ['Propuestas de baja', number(metrics.propuestasBaja)],
    ['Pendientes de revisión', number(metrics.pendientesRevision)],
  ]);
  elements.overviewProgress.value = number(metrics.porcentajeRevision);
  elements.overviewProgress.textContent = `${number(metrics.porcentajeRevision)}%`;
  elements.unitTree.replaceChildren();
  for (const direction of overview.directions) {
    const directionDetails = document.createElement('details');
    const directionSummary = document.createElement('summary');
    directionSummary.textContent = `${direction.name} · ${direction.metrics.finalizadas}/${direction.metrics.sections} secciones finalizadas · ${direction.metrics.porcentajeRevision}%`;
    directionDetails.append(directionSummary);
    for (const department of direction.departments) {
      const departmentDetails = document.createElement('details');
      const departmentSummary = document.createElement('summary');
      departmentSummary.textContent = `${department.name} · ${department.metrics.porcentajeRevision}%`;
      departmentDetails.append(departmentSummary);
      const list = document.createElement('div');
      list.className = 'unit-sections';
      for (const section of department.sections) {
        const row = document.createElement('article');
        row.className = 'unit-row';
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = section.section || 'Sección sin nombre';
        const detail = document.createElement('span');
        detail.textContent = `${section.bienesEsperadosRevisados}/${section.bienesEsperados} revisados · ${section.porcentajeRevision}%`;
        copy.append(title, detail);
        const badge = document.createElement('span');
        badge.className = `unit-state unit-state--${section.state}`;
        badge.textContent = stateLabel(section.state);
        row.append(copy, badge);
        if (section.sessionId) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'secondary no-print';
          button.textContent = 'Ver sesión';
          button.addEventListener('click', () => {
            elements.sessionSelect.value = String(section.sessionId);
            elements.sessionSelect.dispatchEvent(new Event('change'));
          });
          row.append(button);
        }
        list.append(row);
      }
      departmentDetails.append(list);
      directionDetails.append(departmentDetails);
    }
    elements.unitTree.append(directionDetails);
  }
}

function renderExecutive(report) {
  const { summary } = report;
  elements.reportCutoff.textContent = `Corte: ${dateTime(report.generatedAt)}`;
  elements.reportScope.replaceChildren();
  appendDefinition(elements.reportScope, 'Dirección', summary.direction);
  appendDefinition(elements.reportScope, 'Departamento', summary.department);
  appendDefinition(elements.reportScope, 'Sección', summary.section);
  appendDefinition(elements.reportScope, 'Sesión', String(summary.id));
  appendDefinition(elements.reportScope, 'Fecha de revisión', dateTime(summary.completedAt || summary.startedAt));
  renderMetrics(elements.executiveProgress, [
    ['Esperados', number(summary.bienesEsperados)],
    ['Revisados', number(summary.bienesEsperadosRevisados)],
    ['Avance', `${number(summary.porcentajeRevision)}%`],
    ['Pendientes de verificar', number(summary.pendientes)],
  ]);
  renderMetrics(elements.executiveResults, [
    ['Conformes', number(summary.bienesConformes), 'success'],
    ['Otra ubicación', number(summary.diferenciasUbicacion), 'warning'],
    ['No registrados', number(summary.noRegistrados), 'danger'],
    ['Incidencias', number(summary.incidencias), 'warning'],
  ]);
  renderMetrics(elements.executiveSituations, [
    ['Problemas de etiqueta', number(summary.problemasEtiqueta)],
    ['Datos no coincidentes', number(summary.datosNoCoincidentes)],
    ['No operativos', number(summary.noOperativos)],
    ['Propuestas de baja', number(summary.propuestasBaja)],
    ['Pendientes de identificar', number(summary.pendientesIdentificar)],
    ['Requieren revisión', number(summary.requiereRevision)],
  ]);
  elements.evidenceSummary.textContent = `Evidencia: ${number(summary.incidenciasConFoto)} incidencias con fotografías. Correcciones auditadas: ${number(report.corrections)}. Anulaciones auditadas: ${number(report.annulments)}.`;
}

function renderAlerts(alerts) {
  elements.alerts.replaceChildren();
  elements.alertsSection.hidden = alerts.length === 0;
  for (const alert of alerts) {
    const item = document.createElement('article');
    const message = document.createElement('strong');
    message.textContent = alert.message;
    const action = document.createElement('span');
    action.textContent = `Acción sugerida: ${alert.action}`;
    item.append(message, action);
    elements.alerts.append(item);
  }
}

function renderCloseReport(summary) {
  elements.closeState.className = `unit-state unit-state--${summary.status === 'closed' ? 'finalizada' : summary.status === 'open' ? 'en_proceso' : 'cancelada'}`;
  elements.closeState.textContent = stateLabel(summary.status);
  elements.closeDetails.replaceChildren();
  const fields = [
    ['Ubicación', locationText(summary)],
    ['Fecha de revisión', dateTime(summary.completedAt || summary.startedAt)],
    ['Total esperado', summary.bienesEsperados],
    ['Total físicamente verificado', summary.encontrados],
    ['Conformes', summary.bienesConformes],
    ['Pendientes de verificar', summary.pendientes],
    ['No encontrados durante la inspección', summary.noUbicados],
    ['Encontrados en otra ubicación', summary.diferenciasUbicacion],
    ['Bienes no registrados', summary.noRegistrados],
    ['Incidencias', summary.incidencias],
    ['Problemas de etiqueta', summary.problemasEtiqueta],
    ['Bienes no operativos', summary.noOperativos],
    ['Propuestas de baja', summary.propuestasBaja],
    ['Pendientes de revisión', summary.pendientesRevision],
  ];
  for (const [label, value] of fields) appendDefinition(elements.closeDetails, label, String(value ?? 0));
}

function tagList(title, values) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('div');
  list.className = 'tag-list';
  for (const value of values) {
    const tag = document.createElement('span');
    tag.textContent = value.label;
    list.append(tag);
  }
  if (values.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Sin condiciones registradas';
    list.append(empty);
  }
  section.append(heading, list);
  return section;
}

async function openIncidence(
  incidenceId,
  requestedSessionId = state.sessionId,
) {
  try {
    const { incidence } = await api(
      `/api/sessions/${requestedSessionId}/incidences/${incidenceId}`,
    );
    elements.incidenceKind.textContent = incidence.recordKind;
    elements.incidenceDetail.replaceChildren();
    const identity = document.createElement('dl');
    identity.className = 'report-detail-grid';
    appendDefinition(identity, 'Código patrimonial', incidence.assetCode || 'NO APLICA');
    appendDefinition(identity, 'Código provisional', incidence.provisionalCode || 'NO APLICA');
    appendDefinition(identity, 'Bien', incidence.assetName);
    appendDefinition(identity, 'Sesión', String(incidence.sessionId));
    appendDefinition(identity, 'Fecha / hora', dateTime(incidence.observedAt));
    appendDefinition(identity, 'Condición de presencia', incidence.presenceCondition);
    appendDefinition(identity, 'Ubicación registrada', incidence.registeredLocation ? locationText(incidence.registeredLocation) : 'No pertenece al maestro');
    appendDefinition(identity, 'Ubicación física encontrada', locationText(incidence.physicalLocation));
    appendDefinition(identity, 'Prioridad operativa', incidence.priority.toUpperCase());
    appendDefinition(identity, 'Versión vigente', String(incidence.versionNumber));
    appendDefinition(identity, 'Punto físico', incidence.physicalPoint?.type
      ? `${incidence.physicalPoint.type}${incidence.physicalPoint.reference ? ` · ${incidence.physicalPoint.reference}` : ''}`
      : 'No requerido');
    elements.incidenceDetail.append(identity);
    elements.incidenceDetail.append(
      tagList('Identificación / etiqueta', incidence.identification),
      tagList('Estado físico', incidence.physical),
      tagList('Situación', incidence.situation),
    );
    if (incidence.discrepancies.length) {
      const discrepancy = document.createElement('section');
      const heading = document.createElement('h3'); heading.textContent = 'Datos observados que difieren del maestro';
      const list = document.createElement('ul');
      for (const field of incidence.discrepancies) {
        const item = document.createElement('li');
        item.textContent = `${field.field}: maestro “${field.masterValue || 'sin dato'}”; observado “${field.observedValue || 'pendiente de lectura desde evidencia'}”.`;
        list.append(item);
      }
      discrepancy.append(heading, list); elements.incidenceDetail.append(discrepancy);
    }
    if (incidence.incomplete?.parts?.length) {
      const incomplete = document.createElement('p');
      incomplete.textContent = `Partes faltantes: ${incidence.incomplete.parts.join(', ')}${incidence.incomplete.other ? ` · ${incidence.incomplete.other}` : ''}.`;
      elements.incidenceDetail.append(incomplete);
    }
    if (incidence.review?.reason) {
      const review = document.createElement('p'); review.textContent = `Revisión pendiente: ${incidence.review.reason}${incidence.review.detail ? ` · ${incidence.review.detail}` : ''}.`;
      elements.incidenceDetail.append(review);
    }
    const actions = document.createElement('section');
    actions.append(document.createElement('h3'));
    actions.firstChild.textContent = 'Acciones potenciales';
    const actionList = document.createElement('ul');
    for (const action of incidence.actions) {
      const item = document.createElement('li');
      item.textContent = action;
      actionList.append(item);
    }
    if (incidence.actions.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'Sin acción posterior derivada';
      actionList.append(item);
    }
    actions.append(actionList);
    elements.incidenceDetail.append(actions);
    const evidenceSection = document.createElement('section');
    const evidenceTitle = document.createElement('h3');
    evidenceTitle.textContent = `Evidencia (${incidence.evidenceCount})`;
    const gallery = document.createElement('div');
    gallery.className = 'evidence-gallery';
    for (const evidence of incidence.evidence) {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = evidence.url;
      image.alt = `Evidencia: ${evidence.typeLabel}`;
      image.loading = 'lazy';
      const caption = document.createElement('figcaption');
      caption.textContent = evidence.available === false ? `${evidence.typeLabel} · ⚠ EVIDENCIA NO DISPONIBLE` : evidence.typeLabel;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Ver fotografía';
      button.disabled = evidence.available === false;
      button.addEventListener('click', () => {
        elements.photoFull.src = evidence.url;
        elements.photoFull.alt = `Evidencia ampliada: ${evidence.typeLabel}`;
        elements.photoType.textContent = evidence.typeLabel;
        elements.photoDialog.showModal();
      });
      figure.append(image, caption, button);
      gallery.append(figure);
    }
    if (incidence.evidence.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Esta incidencia no tiene fotografía asociada.';
      gallery.append(empty);
    }
    evidenceSection.append(evidenceTitle, gallery);
    elements.incidenceDetail.append(evidenceSection);
    elements.incidenceDialog.showModal();
  } catch (error) {
    setMessage(error.message, true);
  }
}

function renderIncidences(incidences, total = incidences.length) {
  elements.incidenceCount.textContent = String(incidences.length);
  elements.incidenceList.replaceChildren();
  const header = document.createElement('div');
  header.className = 'incidence-row incidence-row--header';
  for (const label of ['Código', 'Bien', 'Situación principal', 'Estado', 'Evidencia', '']) {
    const cell = document.createElement('span');
    cell.textContent = label;
    header.append(cell);
  }
  elements.incidenceList.append(header);
  for (const incidence of incidences) {
    const row = document.createElement('article');
    row.className = 'incidence-row';
    const values = [
      incidence.displayCode,
      incidence.assetName,
      incidence.situation[0]?.label || incidence.identification[0]?.label || incidence.presenceCondition,
      `${incidence.presenceCondition} · ${incidence.priority.toUpperCase()}`,
      incidence.evidenceCount ? `${incidence.evidenceCount} fotografía(s)` : 'Sin fotografía',
    ];
    for (const value of values) {
      const cell = document.createElement('span');
      cell.textContent = value;
      row.append(cell);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ver detalle';
    button.addEventListener('click', () => openIncidence(incidence.id));
    row.append(button);
    elements.incidenceList.append(row);
  }
  if (incidences.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-report';
    empty.textContent = total ? 'Ninguna incidencia cumple todos los filtros seleccionados.' : 'La sesión no tiene incidencias registradas.';
    elements.incidenceList.append(empty);
  }
}

function renderRegularization(groups) {
  elements.regularizationList.replaceChildren();
  for (const group of groups) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${group.action} · ${group.count}`;
    details.append(summary);
    const list = document.createElement('div');
    list.className = 'regularization-items';
    for (const item of group.items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'regularization-item';
      row.textContent = `${item.code} · ${item.name} · prioridad ${item.priority}`;
      row.addEventListener('click', () => openIncidence(item.incidenceId));
      list.append(row);
    }
    details.append(list);
    elements.regularizationList.append(details);
  }
  if (groups.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No hay acciones de regularización derivadas para esta sesión.';
    elements.regularizationList.append(empty);
  }
}

async function applyFilters() {
  if (!state.sessionId) return;
  const filters = [...elements.filters.querySelectorAll('input:checked')].map(({ value }) => value);
  const query = filters.length ? `?filter=${encodeURIComponent(filters.join(','))}` : '';
  try {
    const result = await api(`/api/sessions/${state.sessionId}/incidences${query}`);
    renderIncidences(result.incidences, result.total);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function loadSessionReport(sessionId) {
  const { report } = await api(`/api/sessions/${sessionId}/report`);
  state.sessionId = sessionId;
  state.report = report;
  elements.sessionReport.hidden = false;
  elements.printReport.disabled = false;
  elements.filters.querySelectorAll('input').forEach((input) => { input.checked = false; });
  renderExecutive(report);
  renderAlerts(report.alerts);
  renderCloseReport(report.summary);
  renderIncidences(report.incidences);
  renderRegularization(report.regularization);
  history.replaceState(null, '', `/reports?sessionId=${sessionId}`);
  setMessage(`Informe de la sesión ${sessionId} actualizado.`);
}

elements.sessionSelect.addEventListener('change', async () => {
  const sessionId = Number(elements.sessionSelect.value);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    elements.sessionReport.hidden = true;
    elements.printReport.disabled = true;
    return;
  }
  try {
    await loadSessionReport(sessionId);
  } catch (error) {
    setMessage(error.message, true);
  }
});


elements.explorerDirection.addEventListener(
  'change',
  () => {
    const sections =
      allOverviewSections(state.overview);

    const departments = uniqueSorted(
      sections
        .filter(
          ({ directionName }) =>
            directionName
            === elements.explorerDirection.value,
        )
        .map(
          ({ departmentName }) =>
            departmentName,
        ),
    );

    setExplorerOptions(
      elements.explorerDepartment,
      departments,
    );

    elements.explorerDepartment.disabled =
      !elements.explorerDirection.value;

    setExplorerOptions(
      elements.explorerSection,
      [],
    );

    elements.explorerSection.disabled = true;

    state.explorerLocationId = null;
    state.explorerSessionId = null;

    elements.explorerContent.hidden = true;
    elements.explorerEmpty.hidden = false;
  },
);

elements.explorerDepartment.addEventListener(
  'change',
  () => {
    const sections =
      allOverviewSections(state.overview)
        .filter(
          (section) =>
            section.directionName
              === elements.explorerDirection.value
            && section.departmentName
              === elements.explorerDepartment.value,
        )
        .map(
          (section) => ({
            value: section.locationId,
            label:
              section.section
              || 'Seccion sin nombre',
          }),
        );

    setExplorerOptions(
      elements.explorerSection,
      sections,
    );

    elements.explorerSection.disabled =
      !elements.explorerDepartment.value;

    state.explorerLocationId = null;
    state.explorerSessionId = null;

    elements.explorerContent.hidden = true;
    elements.explorerEmpty.hidden = false;
  },
);

elements.explorerSection.addEventListener(
  'change',
  selectExplorerSection,
);

document.querySelectorAll(
  '[data-explorer-tab]',
).forEach(
  (button) => {
    button.addEventListener(
      'click',
      () => setExplorerTab(
        button.dataset.explorerTab,
      ),
    );
  },
);


elements.explorerSearch.addEventListener(
  'input',
  () => {
    state.explorerQuery =
      elements.explorerSearch.value || '';

    renderExplorerAssets(
      state.explorerAssets,
      state.explorerObservations,
    );
  },
);

elements.presentationMode.addEventListener(
  'click',
  () => {
    const active =
      document.body.classList.toggle(
        'dashboard-presentation',
      );

    elements.presentationMode.setAttribute(
      'aria-pressed',
      String(active),
    );

    elements.presentationMode.textContent =
      active
        ? 'Salir de presentacion'
        : 'Presentar avance';
  },
);


elements.printSectionSummary.addEventListener(
  'click',
  () => {
    document.body.classList.add(
      'print-section-summary',
    );

    window.print();

    window.setTimeout(
      () => {
        document.body.classList.remove(
          'print-section-summary',
        );
      },
      250,
    );
  },
);

elements.closeAssetDialog.addEventListener(
  'click',
  () => {
    elements.assetDialog.close();
  },
);

elements.filters.addEventListener('change', applyFilters);
elements.printReport.addEventListener('click', () => window.print());
elements.closeIncidence.addEventListener('click', () => elements.incidenceDialog.close());
elements.closePhoto.addEventListener('click', () => {
  elements.photoDialog.close();
  elements.photoFull.removeAttribute('src');
});

async function initialize() {
  try {
    const [{ overview }, { sessions }] = await Promise.all([
      api('/api/reports/overview'),
      api('/api/reports/sessions'),
    ]);
    state.overview = overview;
    renderDashboard(overview);
    renderOverview(overview);
    refreshExplorerFilters(overview);
    startDashboardRefresh();

    for (const session of sessions) {
      const option = document.createElement('option');
      option.value = String(session.id);
      option.textContent = `Sesión ${session.id} · ${locationText(session)} · ${stateLabel(session.status)}`;
      elements.sessionSelect.append(option);
    }
    const requested = Number(new URLSearchParams(location.search).get('sessionId'));
    if (Number.isInteger(requested) && sessions.some(({ id }) => id === requested)) {
      elements.sessionSelect.value = String(requested);
      await loadSessionReport(requested);
    }
  } catch (error) {
    setMessage(error.message, true);
  }
}

window.addEventListener(
  'pagehide',
  stopDashboardRefresh,
);

initialize();
