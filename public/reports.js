const elements = {
  sessionSelect: document.querySelector('#session-select'),
  printReport: document.querySelector('#print-report'),
  overviewCutoff: document.querySelector('#overview-cutoff'),
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

const state = { sessionId: null, report: null };

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

async function openIncidence(incidenceId) {
  try {
    const { incidence } = await api(`/api/sessions/${state.sessionId}/incidences/${incidenceId}`);
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
    renderOverview(overview);
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

initialize();
