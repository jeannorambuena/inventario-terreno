const elements = {
  connection: document.querySelector('#connection-status'),
  direction: document.querySelector('#direction'),
  department: document.querySelector('#department'),
  section: document.querySelector('#section'),
  operatorCode: document.querySelector('#operator-code'),
  startSession: document.querySelector('#start-session'),
  resumePanel: document.querySelector('#resume-panel'),
  resumeSessions: document.querySelector('#resume-sessions'),
  workPanel: document.querySelector('#work-panel'),
  activeLocation: document.querySelector('#active-location'),
  closeSession: document.querySelector('#close-session'),
  generatePairing: document.querySelector('#generate-pairing'),
  pairingPanel: document.querySelector('#pairing-panel'),
  pairingQr: document.querySelector('#pairing-qr'),
  mobileUrl: document.querySelector('#mobile-url'),
  pairingExpiry: document.querySelector('#pairing-expiry'),
  refreshPairing: document.querySelector('#refresh-pairing'),
  lookupForm: document.querySelector('#lookup-form'),
  lookupCode: document.querySelector('#lookup-code'),
  assetResult: document.querySelector('#asset-result'),
  assetResultLabel: document.querySelector('#asset-result-label'),
  assetName: document.querySelector('#asset-name'),
  assetDetails: document.querySelector('#asset-details'),
  observationForm: document.querySelector('#observation-form'),
  observationStatus: document.querySelector('#observation-status'),
  addEvidence: document.querySelector('#add-evidence'),
  evidenceFile: document.querySelector('#evidence-file'),
  evidenceStatus: document.querySelector('#evidence-status'),
  evidenceQueue: document.querySelector('#evidence-queue'),
  cancelIncidence: document.querySelector('#cancel-incidence'),
  incidenceMode: document.querySelector('#incidence-mode'),
  metricExpected: document.querySelector('#metric-expected'),
  metricFound: document.querySelector('#metric-found'),
  metricPending: document.querySelector('#metric-pending'),
  metricIncidents: document.querySelector('#metric-incidents'),
  lastRecord: document.querySelector('#last-record'),
  lastCode: document.querySelector('#last-code'),
  lastName: document.querySelector('#last-name'),
  lastResult: document.querySelector('#last-result'),
  undoLast: document.querySelector('#undo-last'),
  undoDialog: document.querySelector('#undo-dialog'),
  undoForm: document.querySelector('#undo-form'),
  undoDetails: document.querySelector('#undo-details'),
  undoReason: document.querySelector('#undo-reason'),
  undoConfirm: document.querySelector('#undo-confirm'),
  confirmUndo: document.querySelector('#confirm-undo'),
  dismissUndo: document.querySelector('#dismiss-undo'),
  progress: document.querySelector('#progress'),
  progressLabel: document.querySelector('#progress-label'),
  conformanceLabel: document.querySelector('#conformance-label'),
  progressPercent: document.querySelector('#progress-percent'),
  pendingCount: document.querySelector('#pending-count'),
  pendingAssets: document.querySelector('#pending-assets'),
  sessionRecords: document.querySelector('#session-records'),
  closurePanel: document.querySelector('#closure-panel'),
  closureState: document.querySelector('#closure-state'),
  closureMetrics: document.querySelector('#closure-metrics'),
  closureBlockers: document.querySelector('#closure-blockers'),
  closureConfirmLabel: document.querySelector('#closure-confirm-label'),
  closureConfirm: document.querySelector('#closure-confirm'),
  finalizeSession: document.querySelector('#finalize-session'),
  dismissClosure: document.querySelector('#dismiss-closure'),
  summaryPanel: document.querySelector('#summary-panel'),
  summaryDetails: document.querySelector('#summary-details'),
  summaryReportLink: document.querySelector('#summary-report-link'),
  cancelDialog: document.querySelector('#cancel-dialog'),
  cancelForm: document.querySelector('#cancel-form'),
  cancelDetails: document.querySelector('#cancel-details'),
  cancelReason: document.querySelector('#cancel-reason'),
  cancelConfirm: document.querySelector('#cancel-confirm'),
  dismissCancel: document.querySelector('#dismiss-cancel'),
  message: document.querySelector('#message'),
};

const state = {
  locations: [],
  locationId: null,
  sessionId: null,
  sessionStarting: false,
  asset: null,
  provisionalCode: null,
  incidenceMode: false,
  registrationRunning: false,
  pollTimer: null,
  pollRunning: false,
  pairingRunning: false,
  cancelSession: null,
  lastObservation: null,
  undoCandidate: null,
  undoRunning: false,
  evidenceQueue: [],
  evidenceTarget: null,
  correctionObservation: null,
  correctionReasonCode: null,
  readiness: null,
  pendingSignature: '',
  recordsSignature: '',
};

const sessionStorageKey = 'inventario-terreno.sessionId';
const deviceStorageKey = 'inventario-terreno.deviceId';
const operatorStorageKey = 'inventario-terreno.operatorCode';
const svgNamespace = 'http://www.w3.org/2000/svg';

function getDeviceCode() {
  let value = localStorage.getItem(deviceStorageKey);
  if (!value) {
    value = `NOTEBOOK-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(deviceStorageKey, value);
  }
  return value;
}

function getOperatorCode() {
  return elements.operatorCode.value.trim() || 'OPERADOR';
}

function createIcon(name) {
  const icon = document.createElementNS(svgNamespace, 'svg');
  const use = document.createElementNS(svgNamespace, 'use');
  icon.classList.add('icon');
  icon.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `/icons.svg#${name}`);
  icon.append(use);
  return icon;
}

function setButtonContent(button, iconName, label) {
  const text = document.createElement('span');
  text.textContent = label;
  button.replaceChildren(createIcon(iconName), text);
}

async function api(path, options) {
  const hasFormData = options?.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: { ...(hasFormData ? {} : { 'Content-Type': 'application/json' }), ...(options?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || 'No fue posible completar la operación.');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function setMessage(message = '', error = false) {
  elements.message.replaceChildren();
  if (message) {
    const text = document.createElement('span');
    text.textContent = message;
    elements.message.append(createIcon(error ? 'error' : 'success'), text);
  }
  elements.message.classList.toggle('error', error);
}

function setOptions(select, values, placeholder = 'Seleccione…') {
  select.replaceChildren(new Option(placeholder, ''));
  for (const value of values) select.add(new Option(value || 'Sin especificar', JSON.stringify(value)));
  select.disabled = values.length === 0;
}

function selectedValue(select) {
  return select.value === '' ? null : JSON.parse(select.value);
}

function distinct(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'es'));
}

function appendDetail(container, label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'detail-item';
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value || '—';
  wrapper.append(term, detail);
  container.append(wrapper);
}

function numericMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function setIncidenceMode(active) {
  state.incidenceMode = active;
  elements.incidenceMode.setAttribute('aria-pressed', String(active));
  elements.incidenceMode.classList.toggle('incidence-mode--active', active);
  setButtonContent(elements.incidenceMode, 'warning', active ? 'Incidencia activa' : 'Incidencia');
}

function resultLabel(status) {
  return ({
    verificado: 'Encontrado en ubicación correcta',
    otra_ubicacion: 'Encontrado en otra ubicación',
    no_ubicado: 'No ubicado',
    desconocido: 'Hallazgo provisional',
    dato_distinto: 'Incidencia registrada',
  })[status] || 'Observación registrada';
}

function renderLastRecord(observation, canUndo = false) {
  state.lastObservation = observation;
  if (!observation) {
    elements.lastRecord.hidden = true;
    elements.undoLast.hidden = true;
    return;
  }
  const { code, name, status } = observation;
  elements.lastCode.textContent = code || '—';
  elements.lastName.textContent = name || 'Bien sin descripción';
  elements.lastResult.textContent = resultLabel(status);
  elements.undoLast.hidden = !canUndo || !observation.observationCode;
  elements.lastRecord.hidden = false;
}

function openUndoDialog() {
  if (!state.sessionId || !state.lastObservation || state.undoRunning) return;
  state.undoCandidate = { ...state.lastObservation };
  elements.undoDetails.replaceChildren();
  appendDetail(elements.undoDetails, 'Código', state.undoCandidate.code);
  appendDetail(elements.undoDetails, 'Bien', state.undoCandidate.name);
  appendDetail(elements.undoDetails, 'Resultado', resultLabel(state.undoCandidate.status));
  appendDetail(
    elements.undoDetails,
    'Registrado',
    new Date(state.undoCandidate.observedAt).toLocaleString('es-CL'),
  );
  elements.undoForm.reset();
  if (typeof elements.undoDialog.showModal === 'function') elements.undoDialog.showModal();
  else elements.undoDialog.setAttribute('open', '');
}

elements.undoLast.addEventListener('click', openUndoDialog);

elements.dismissUndo.addEventListener('click', () => {
  state.undoCandidate = null;
  elements.undoDialog.close();
});

elements.undoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.undoCandidate || !elements.undoConfirm.checked || state.undoRunning) return;
  state.undoRunning = true;
  elements.confirmUndo.disabled = true;
  elements.undoLast.disabled = true;
  const candidate = state.undoCandidate;
  try {
    await api(`/api/sessions/${state.sessionId}/observations/undo-last`, {
      method: 'POST',
      body: JSON.stringify({
        observationCode: candidate.observationCode,
        reason: elements.undoReason.value,
        confirm: true,
      }),
    });
    elements.undoDialog.close();
    state.undoCandidate = null;
    await updateProgress();
    setMessage(`Se deshizo el registro ${candidate.code} y quedó trazabilidad en la auditoría.`);
    elements.lookupCode.focus();
  } catch (error) {
    if (error.status === 409) {
      elements.undoDialog.close();
      state.undoCandidate = null;
      await updateProgress();
    }
    setMessage(error.message, true);
  } finally {
    state.undoRunning = false;
    elements.confirmUndo.disabled = false;
    elements.undoLast.disabled = false;
  }
});

function resetEntryFlow() {
  elements.lookupForm.reset();
  elements.observationForm.reset();
  elements.observationStatus.disabled = false;
  elements.evidenceStatus.textContent = '';
  elements.evidenceQueue.replaceChildren();
  elements.assetResult.hidden = true;
  elements.observationForm.hidden = true;
  state.asset = null;
  state.provisionalCode = null;
  state.evidenceQueue = [];
  state.evidenceTarget = null;
  state.correctionObservation = null;
  state.correctionReasonCode = null;
  setIncidenceMode(false);
  elements.lookupCode.focus();
}

async function registerObservation({ asset = null, provisionalCode = null, status, observation = '', lookupCode = '' }) {
  if (state.registrationRunning) return;
  state.registrationRunning = true;
  try {
    await api(`/api/sessions/${state.sessionId}/observations`, {
      method: 'POST',
      body: JSON.stringify({
        assetId: asset?.id ?? null,
        provisionalCode,
        status,
        locationId: state.locationId,
        observation,
        observedAt: new Date().toISOString(),
        lookupCode,
        operatorCode: getOperatorCode(),
        deviceCode: getDeviceCode(),
      }),
    });
    resetEntryFlow();
    await updateProgress();
    setMessage(status === 'verificado' ? 'Bien registrado. Listo para el siguiente código.' : 'Incidencia registrada.');
  } finally {
    state.registrationRunning = false;
  }
}

function openIncidencePanel() {
  setIncidenceMode(true);

  if (!state.asset && !state.provisionalCode) {
    showAsset(null, null);
    document.querySelector('#label-condition').value = 'sin_etiqueta';
    updateStructuredVisibility();
    setMessage('Hallazgo sin c?digo. Describa el bien y el sistema generar? un identificador provisional.');
    return;
  }

  elements.observationForm.hidden = false;
  elements.observationStatus.value = state.asset?.locationId === state.locationId
    ? 'dato_distinto'
    : state.asset ? 'otra_ubicacion' : 'dato_distinto';
  elements.observationForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setMessage('Clasifique la excepci?n y guarde la incidencia.');
}

elements.incidenceMode.addEventListener('click', openIncidencePanel);

elements.cancelIncidence.addEventListener('click', () => {
  resetEntryFlow();
  setMessage('Incidencia cancelada. No se registró ningún cambio.');
});

elements.addEvidence.addEventListener('click', () => {
  const type = elements.observationForm.querySelector('input[name="evidence-type"]:checked');
  if (!type) {
    setMessage('Seleccione primero qué muestra la fotografía.', true);
    return;
  }
  elements.evidenceFile.click();
});

elements.evidenceFile.addEventListener('change', () => {
  const type = elements.observationForm.querySelector('input[name="evidence-type"]:checked')?.value;
  const files = [...(elements.evidenceFile.files || [])];
  if (!type || files.length === 0) return;
  if (state.evidenceTarget) {
    void uploadEvidenceFiles(state.evidenceTarget, files.map((file) => ({ file, type }))).finally(() => {
      state.evidenceTarget = null;
      elements.evidenceFile.value = '';
    });
    return;
  }
  for (const file of files) state.evidenceQueue.push({ file, type });
  renderEvidenceQueue();
  elements.evidenceFile.value = '';
});

function renderEvidenceQueue() {
  elements.evidenceQueue.replaceChildren();
  state.evidenceQueue.forEach(({ file, type }, index) => {
    const item = document.createElement('span');
    item.className = 'evidence-chip';
    item.textContent = `✓ ${type.replaceAll('_', ' ')} · ${file.name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Quitar';
    remove.addEventListener('click', () => {
      state.evidenceQueue.splice(index, 1);
      renderEvidenceQueue();
    });
    item.append(remove);
    elements.evidenceQueue.append(item);
  });
  elements.evidenceStatus.textContent = state.evidenceQueue.length
    ? `${state.evidenceQueue.length} fotografía(s) preparada(s).`
    : '';
}

async function uploadEvidenceFiles(observationId, evidenceItems) {
  for (const { file, type } of evidenceItems) {
    const body = new FormData();
    body.append('evidenceType', type);
    body.append('operatorCode', getOperatorCode());
    body.append('deviceCode', getDeviceCode());
    body.append('evidence', file);
    await api(`/api/sessions/${state.sessionId}/observations/${observationId}/evidence`, { method: 'POST', body });
  }
  setMessage(`${evidenceItems.length} evidencia(s) guardada(s) localmente.`);
  await loadSessionRecords();
}

async function loadLocations() {
  const { locations } = await api('/api/locations');
  state.locations = locations;
  setOptions(elements.direction, distinct(locations.map(({ direction }) => direction)));
}

async function createPairing() {
  if (!state.sessionId || state.pairingRunning) return;
  state.pairingRunning = true;
  elements.generatePairing.disabled = true;
  elements.refreshPairing.disabled = true;
  try {
    const { pairing } = await api(`/api/sessions/${state.sessionId}/pair`, { method: 'POST' });
    elements.mobileUrl.href = pairing.mobileUrl;
    elements.mobileUrl.textContent = 'Abrir sesión móvil';
    elements.pairingQr.src = pairing.qrDataUrl;
    elements.pairingExpiry.textContent = `Válido hasta ${new Date(pairing.expiresAt).toLocaleString('es-CL')}`;
    elements.pairingPanel.hidden = false;
    elements.generatePairing.hidden = true;
  } finally {
    state.pairingRunning = false;
    elements.generatePairing.disabled = false;
    elements.refreshPairing.disabled = false;
  }
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.pollRunning = false;
}

async function pollSession() {
  if (!state.sessionId || state.pollRunning) return;
  state.pollRunning = true;
  try {
    const summary = await updateProgress();
    if (summary.status !== 'open') {
      stopPolling();
      localStorage.removeItem(sessionStorageKey);
    }
  } catch {
    // La pérdida temporal de red no altera la sesión ni los formularios activos.
  } finally {
    state.pollRunning = false;
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(pollSession, 2500);
}

function selectLocation(location) {
  elements.direction.value = JSON.stringify(location.direction);
  elements.direction.dispatchEvent(new Event('change'));
  elements.department.value = JSON.stringify(location.department);
  elements.department.dispatchEvent(new Event('change'));
  elements.section.value = JSON.stringify(location.section);
  state.locationId = location.id;
}

async function activateSession(summary, resumed = true) {
  const location = state.locations.find(({ id }) => id === summary.locationId);
  if (location) selectLocation(location);
  state.sessionId = summary.id;
  state.locationId = summary.locationId;
  state.pendingSignature = '';
  state.recordsSignature = '';
  if (summary.operatorCode) elements.operatorCode.value = summary.operatorCode;
  elements.activeLocation.textContent = [summary.direction, summary.department, summary.section]
    .filter(Boolean).join(' / ') || 'Ubicación sin descripción';
  localStorage.setItem(sessionStorageKey, String(summary.id));
  elements.workPanel.hidden = false;
  elements.summaryPanel.hidden = true;
  elements.startSession.disabled = true;
  elements.resumePanel.hidden = true;
  elements.pairingPanel.hidden = true;
  elements.pairingQr.removeAttribute('src');
  elements.mobileUrl.removeAttribute('href');
  elements.mobileUrl.textContent = '';
  elements.pairingExpiry.textContent = '';
  elements.generatePairing.hidden = false;
  setIncidenceMode(false);
  await updateProgress();
  startPolling();
  elements.lookupCode.focus();
  setMessage(resumed ? 'Se reanudó la sesión abierta.' : 'Sesión iniciada.');
}

function showSessionConflict(sessions) {
  elements.resumeSessions.replaceChildren();
  for (const session of sessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    setButtonContent(button, 'refresh', `Reanudar sesión ${session.id} (${numericMetric(session.bienesEsperadosRevisados)}/${numericMetric(session.bienesEsperados)})`);
    button.addEventListener('click', async () => {
      try {
        await activateSession(session, true);
      } catch (error) {
        setMessage(error.message, true);
      }
    });
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'danger';
    setButtonContent(cancelButton, 'cancel', 'Cancelar sesión de prueba');
    cancelButton.addEventListener('click', () => openCancellation(session));
    elements.resumeSessions.append(button, cancelButton);
  }
  elements.resumePanel.hidden = sessions.length === 0;
}

async function inspectOpenSessions() {
  elements.resumePanel.hidden = true;
  elements.resumeSessions.replaceChildren();
  setButtonContent(elements.startSession, 'play', 'Iniciar sesión');
  if (!state.locationId || state.sessionId) return;
  try {
    const { sessions } = await api(`/api/sessions/open?locationId=${state.locationId}`);
    if (sessions.length === 1) setButtonContent(elements.startSession, 'refresh', 'Reanudar sesión');
    if (sessions.length > 0) showSessionConflict(sessions);
  } catch {
    // POST /sessions vuelve a comprobar el estado dentro de una transacción.
  }
}

async function recoverStoredSession() {
  const stored = Number(localStorage.getItem(sessionStorageKey));
  if (!Number.isInteger(stored) || stored <= 0) {
    localStorage.removeItem(sessionStorageKey);
    return;
  }
  try {
    const { summary } = await api(`/api/sessions/${stored}/summary`);
    if (summary.status !== 'open') {
      localStorage.removeItem(sessionStorageKey);
      return;
    }
    await activateSession(summary, true);
  } catch (error) {
    if (error.status === 404) localStorage.removeItem(sessionStorageKey);
    else setMessage('No fue posible recuperar la sesión; se reintentará al restablecer la red.', true);
  }
}

elements.refreshPairing.addEventListener('click', async () => {
  try {
    await createPairing();
    setMessage('Enlace móvil renovado. Todos los enlaces anteriores fueron revocados.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.generatePairing.addEventListener('click', async () => {
  try {
    await createPairing();
    setMessage('Enlace móvil generado. El token se muestra únicamente dentro de la URL y no se almacena en el navegador.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

function openCancellation(session) {
  state.cancelSession = session;
  elements.cancelDetails.replaceChildren();
  appendDetail(elements.cancelDetails, 'ID', String(session.id));
  appendDetail(elements.cancelDetails, 'Ubicación', [session.direction, session.department, session.section].filter(Boolean).join(' / '));
  appendDetail(elements.cancelDetails, 'Bienes revisados', String(numericMetric(session.bienesEsperadosRevisados)));
  appendDetail(elements.cancelDetails, 'Observaciones', String(numericMetric(session.observacionesTotales)));
  elements.cancelForm.reset();
  if (typeof elements.cancelDialog.showModal === 'function') elements.cancelDialog.showModal();
  else elements.cancelDialog.setAttribute('open', '');
}

elements.dismissCancel.addEventListener('click', () => {
  state.cancelSession = null;
  elements.cancelDialog.close();
});

elements.cancelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.cancelSession || !elements.cancelConfirm.checked) return;
  try {
    const { summary } = await api(`/api/sessions/${state.cancelSession.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: elements.cancelReason.value, confirm: true }),
    });
    elements.cancelDialog.close();
    if (state.sessionId === summary.id) {
      stopPolling();
      localStorage.removeItem(sessionStorageKey);
      state.sessionId = null;
      elements.workPanel.hidden = true;
    }
    state.cancelSession = null;
    await inspectOpenSessions();
    setMessage(`Sesión ${summary.id} cancelada de forma auditable.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.direction.addEventListener('change', () => {
  const selectedDirection = selectedValue(elements.direction);
  const matches = state.locations.filter(({ direction }) => direction === selectedDirection);
  setOptions(elements.department, distinct(matches.map(({ department }) => department)));
  setOptions(elements.section, []);
  elements.startSession.disabled = true;
});

elements.department.addEventListener('change', () => {
  const selectedDirection = selectedValue(elements.direction);
  const selectedDepartment = selectedValue(elements.department);
  const matches = state.locations.filter(({ direction, department }) => (
    direction === selectedDirection && department === selectedDepartment
  ));
  setOptions(elements.section, distinct(matches.map(({ section }) => section)));
  elements.startSession.disabled = true;
});

elements.section.addEventListener('change', async () => {
  const selectedDirection = selectedValue(elements.direction);
  const selectedDepartment = selectedValue(elements.department);
  const selectedSection = selectedValue(elements.section);
  const location = state.locations.find(({ direction, department, section }) => (
    direction === selectedDirection
    && department === selectedDepartment
    && section === selectedSection
  ));
  state.locationId = location?.id ?? null;
  elements.startSession.disabled = !state.locationId || Boolean(state.sessionId) || state.sessionStarting;
  await inspectOpenSessions();
});

elements.startSession.addEventListener('click', async () => {
  if (!state.locationId || state.sessionId || state.sessionStarting) return;
  state.sessionStarting = true;
  elements.startSession.disabled = true;
  try {
    const { session, resumed } = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        locationId: state.locationId,
        operatorCode: getOperatorCode(),
        deviceCode: getDeviceCode(),
      }),
    });
    await activateSession(session, resumed);
  } catch (error) {
    elements.startSession.disabled = !state.locationId;
    if (error.status === 409 && Array.isArray(error.body?.sessions)) {
      showSessionConflict(error.body.sessions);
    }
    setMessage(error.message, true);
  } finally {
    state.sessionStarting = false;
  }
});

function showAsset(asset, provisionalCode) {
  state.asset = asset;
  state.provisionalCode = provisionalCode;
  elements.assetDetails.replaceChildren();
  elements.observationStatus.disabled = false;
  elements.assetResultLabel.textContent = asset ? 'Bien encontrado' : 'Incidencia provisional';
  elements.assetName.textContent = asset?.name || 'Bien no encontrado en el inventario maestro';
  if (asset) {
    appendDetail(elements.assetDetails, 'Código del bien', asset.assetCode);
    appendDetail(elements.assetDetails, 'Código escáner', asset.scannerCode);
    appendDetail(elements.assetDetails, 'Marca', asset.brand);
    appendDetail(elements.assetDetails, 'Modelo', asset.model);
    appendDetail(elements.assetDetails, 'Serie', asset.serialNumber);
    if (asset.locationId === state.locationId) {
      elements.observationStatus.value = 'dato_distinto';
    } else {
      elements.observationStatus.value = 'otra_ubicacion';
      const otherLocation = elements.observationForm.querySelector('input[name="situation"][value="otra_ubicacion"]');
      otherLocation.checked = true;
    }
  } else {
    appendDetail(elements.assetDetails, 'Código ingresado', provisionalCode);
    elements.observationStatus.value = 'desconocido';
    elements.observationStatus.disabled = true;
    const unregistered = elements.observationForm.querySelector('input[name="situation"][value="bien_no_registrado"]');
    unregistered.checked = true;
    document.querySelector('#provisional-observed-code').value = provisionalCode || '';
  }
  updateStructuredVisibility();
  elements.assetResult.hidden = false;
  elements.observationForm.hidden = false;
  setIncidenceMode(true);
}

async function handleResolvedAsset(asset, code) {
  if (asset.locationId === state.locationId && !state.incidenceMode) {
    await registerObservation({ asset, status: 'verificado', lookupCode: code });
    return;
  }
  showAsset(asset, null);
  setMessage(asset.locationId === state.locationId
    ? 'Complete la incidencia antes de registrar.'
    : 'El bien pertenece a otra ubicación. Registre la incidencia.');
  elements.observationForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showLookupChoice(lookup) {
  elements.assetResult.hidden = false;
  elements.observationForm.hidden = true;
  elements.assetResultLabel.textContent = 'Múltiples coincidencias';
  elements.assetName.textContent = 'Seleccione el bien correcto';
  elements.assetDetails.replaceChildren();
  for (const asset of lookup.matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    setButtonContent(button, 'inventory', `${asset.assetCode} — ${asset.name} · ${asset.department || '—'} / ${asset.section || '—'} · ${asset.alreadyObserved ? 'Ya revisado' : 'Pendiente'}`);
    button.disabled = asset.alreadyObserved;
    button.addEventListener('click', () => { void handleResolvedAsset(asset, lookup.code); });
    elements.assetDetails.append(button);
  }
}

elements.lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.lookupCode.value.trim();
  if (!code) return;
  try {
    const { asset, lookup } = await api(`/api/assets/by-code/${encodeURIComponent(code)}?sessionId=${state.sessionId}`);
    if (lookup?.ambiguous) {
      showLookupChoice(lookup);
      setMessage('Seleccione una coincidencia pendiente. Una coincidencia ya revisada no bloquea las demás.');
      return;
    }
    if (lookup?.alreadyObserved) {
      elements.assetResult.hidden = true;
      elements.observationForm.hidden = true;
      setMessage('Este bien ya fue observado en la sesión.', true);
      return;
    }
    await handleResolvedAsset(asset, code);
  } catch (error) {
    if (error.message === 'Bien no encontrado.') {
      setIncidenceMode(true);
      showAsset(null, code);
      setMessage('Bien no encontrado en el inventario maestro. Se seleccionó Bien no registrado.');
      elements.observationForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setMessage(error.message, true);
    }
  }
});

function checkedValues(name) {
  return [...elements.observationForm.querySelectorAll(`input[name="${name}"]:checked`)].map(({ value }) => value);
}

function currentFieldDetails() {
  const situations = checkedValues('situation');
  const discrepancy = document.querySelector('#discrepancy-fields').hidden ? [] : [{
    field: document.querySelector('#discrepancy-field').value,
    masterValue: document.querySelector('#discrepancy-master').value,
    observedValue: document.querySelector('#discrepancy-observed').value,
    pendingFromEvidence: document.querySelector('#discrepancy-from-evidence').checked,
  }];
  return {
    label: document.querySelector('#label-condition').value,
    physicalCondition: document.querySelector('#physical-condition').value,
    functionality: document.querySelector('#functionality').value,
    proposedDisposal: document.querySelector('#proposed-disposal').checked,
    situations,
    physicalPoint: {
      type: document.querySelector('#physical-point-type').value,
      reference: document.querySelector('#physical-point-reference').value,
    },
    provisional: {
      description: document.querySelector('#provisional-description').value,
      brand: document.querySelector('#provisional-brand').value,
      model: document.querySelector('#provisional-model').value,
      serialNumber: document.querySelector('#provisional-serial').value,
      observedCode: document.querySelector('#provisional-observed-code').value || state.provisionalCode || '',
      pendingIdentification: document.querySelector('#provisional-pending').checked,
    },
    discrepancies: discrepancy,
    incomplete: { parts: checkedValues('incomplete-part'), other: document.querySelector('#incomplete-other').value },
    review: { reason: document.querySelector('#review-reason').value, detail: document.querySelector('#review-detail').value },
    custody: {
      destination: document.querySelector('#custody-destination').value,
      reference: document.querySelector('#custody-reference').value,
      basis: document.querySelector('#custody-basis').value,
    },
  };
}

function legacySelections(details) {
  const identification = [];
  const labelMap = { deteriorada: 'etiqueta_deteriorada', ilegible: 'etiqueta_ilegible', sin_etiqueta: 'sin_etiqueta', posible_duplicada: 'posible_etiqueta_duplicada' };
  if (labelMap[details.label]) identification.push(labelMap[details.label]);
  if (details.discrepancies.length) identification.push('datos_no_coinciden');
  if (details.provisional.pendingIdentification) identification.push('pendiente_identificar');
  const physical = [];
  if (['regular', 'malo', 'incompleto'].includes(details.physicalCondition)) physical.push(details.physicalCondition);
  if (details.functionality === 'no_operativo') physical.push('no_operativo');
  if (details.proposedDisposal) physical.push('propuesta_baja');
  return { identification, physical, situation: details.situations };
}

function updateStructuredVisibility() {
  const status = elements.observationStatus.value;
  const situations = checkedValues('situation');
  document.querySelector('#provisional-fields').hidden = Boolean(state.asset);
  document.querySelector('#discrepancy-fields').hidden = status !== 'dato_distinto';
  document.querySelector('#incomplete-fields').hidden = document.querySelector('#physical-condition').value !== 'incompleto';
  document.querySelector('#review-fields').hidden = !situations.includes('requiere_revision');
  document.querySelector('#custody-fields').hidden = !situations.some((value) => ['en_reparacion', 'prestamo_informado', 'traslado_no_regularizado'].includes(value));
  document.querySelector('#physical-point-fields').hidden = !(!state.asset || status === 'otra_ubicacion' || situations.includes('requiere_revision') || situations.includes('traslado_no_regularizado'));
  const masterField = document.querySelector('#discrepancy-field').value;
  const source = { description: state.asset?.name, brand: state.asset?.brand, model: state.asset?.model, serialNumber: state.asset?.serialNumber, assetType: state.asset?.name, otherIdentifier: state.asset?.assetCode };
  document.querySelector('#discrepancy-master').value = source[masterField] || '';
}

elements.observationForm.addEventListener('change', updateStructuredVisibility);

elements.observationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const details = currentFieldDetails();
  const selections = legacySelections(details);
  const body = new FormData();
  if (state.asset) body.append('assetId', String(state.asset.id));
  body.append('status', elements.observationStatus.value);
  body.append('identification', JSON.stringify(selections.identification));
  body.append('physical', JSON.stringify(selections.physical));
  body.append('situation', JSON.stringify(selections.situation));
  body.append('details', JSON.stringify(details));
  body.append('operatorCode', getOperatorCode());
  body.append('deviceCode', getDeviceCode());
  const firstEvidence = state.evidenceQueue[0];
  if (firstEvidence) {
    body.append('evidenceType', firstEvidence.type);
    body.append('evidence', firstEvidence.file);
  }
  try {
    let result;
    if (state.correctionObservation) {
      result = await api(`/api/sessions/${state.sessionId}/observations/${state.correctionObservation.id}/correct`, {
        method: 'POST',
        body: JSON.stringify({
          expectedObservationCode: state.correctionObservation.observationCode,
          action: 'correct',
          reasonCode: state.correctionReasonCode || 'error_dato',
          operatorCode: getOperatorCode(),
          deviceCode: getDeviceCode(),
          status: elements.observationStatus.value,
          details,
        }),
      });
      if (state.evidenceQueue.length) await uploadEvidenceFiles(result.observation.id, state.evidenceQueue);
    } else {
      result = await api(`/api/sessions/${state.sessionId}/incidences`, { method: 'POST', body });
      if (state.evidenceQueue.length > 1) await uploadEvidenceFiles(result.observation.id, state.evidenceQueue.slice(1));
    }
    const registeredCode = result.observation.provisionalCode || state.asset?.assetCode || state.provisionalCode;
    resetEntryFlow();
    await updateProgress();
    setMessage(`Incidencia guardada para ${registeredCode}. Listo para el siguiente código.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

async function updateProgress() {
  const { summary } = await api(`/api/sessions/${state.sessionId}/summary`);
  const progressPercent = numericMetric(summary.progressPercent);
  const reviewed = numericMetric(summary.bienesEsperadosRevisados);
  const conforming = numericMetric(summary.bienesConformes);
  const totalAssets = numericMetric(summary.bienesEsperados);
  const found = numericMetric(summary.encontrados);
  const pending = numericMetric(summary.pendientes);
  const incidents = numericMetric(summary.incidencias);
  elements.progress.value = progressPercent;
  elements.progress.textContent = `${progressPercent}%`;
  elements.progressLabel.textContent = `${reviewed} de ${totalAssets} bienes revisados`;
  elements.conformanceLabel.textContent = `${conforming} bienes conformes`;
  elements.progressPercent.textContent = `${progressPercent}%`;
  elements.metricExpected.textContent = String(totalAssets);
  elements.metricFound.textContent = String(found);
  elements.metricPending.textContent = String(pending);
  elements.metricIncidents.textContent = String(incidents);
  renderLastRecord(summary.lastObservation, summary.status === 'open');
  await loadPendingAssets();
  await loadSessionRecords();
  return summary;
}

async function loadPendingAssets() {
  const { assets } = await api(`/api/sessions/${state.sessionId}/pending-assets`);
  elements.pendingCount.textContent = String(assets.length);
  const signature = JSON.stringify(assets.map(({ id }) => id));
  if (signature === state.pendingSignature) return;
  state.pendingSignature = signature;
  elements.pendingAssets.replaceChildren();
  for (const asset of assets) {
    const item = document.createElement('article');
    item.className = 'pending-item';
    const content = document.createElement('div');
    content.className = 'pending-item__content';
    const code = document.createElement('p');
    code.className = 'pending-item__code';
    code.textContent = `Bien ${asset.assetCode} · Escáner ${asset.scannerCode || '—'}`;
    const name = document.createElement('p');
    name.className = 'pending-item__name';
    name.textContent = asset.name || '—';
    const metadata = document.createElement('p');
    metadata.className = 'pending-item__meta';
    metadata.textContent = `${asset.brand || '—'} · ${asset.model || '—'} · Serie ${asset.serialNumber || '—'}`;
    content.append(code, name, metadata);
    const markMissing = document.createElement('button');
    markMissing.type = 'button';
    markMissing.className = 'secondary secondary--warning';
    markMissing.textContent = 'No encontrado en terreno';
    markMissing.addEventListener('click', async () => {
      if (!window.confirm(`¿Confirma que buscó ${asset.assetCode} y no estaba físicamente en la oficina?`)) return;
      try {
        await api(`/api/sessions/${state.sessionId}/assets/${asset.id}/not-found`, {
          method: 'POST',
          body: JSON.stringify({ confirm: true, operatorCode: getOperatorCode(), deviceCode: getDeviceCode() }),
        });
        await updateProgress();
        setMessage(`${asset.assetCode} quedó explícitamente como No encontrado en terreno.`);
      } catch (error) { setMessage(error.message, true); }
    });
    item.append(content, markMissing);
    elements.pendingAssets.append(item);
  }
}

function loadObservationForCorrection(observation, reasonCode = 'error_dato') {
  state.correctionObservation = observation;
  state.correctionReasonCode = reasonCode;
  state.asset = observation.assetId ? { id: observation.assetId, assetCode: observation.assetCode, name: observation.assetName, locationId: state.locationId } : null;
  state.provisionalCode = observation.provisionalCode;
  elements.observationStatus.disabled = false;
  elements.observationStatus.value = observation.status;
  const details = observation.details || {};
  document.querySelector('#label-condition').value = details.label || 'correcta';
  document.querySelector('#physical-condition').value = details.physicalCondition || 'bueno';
  document.querySelector('#functionality').value = details.functionality || 'operativo';
  document.querySelector('#proposed-disposal').checked = Boolean(details.proposedDisposal);
  for (const input of elements.observationForm.querySelectorAll('input[name="situation"]')) input.checked = details.situations?.includes(input.value) || false;
  document.querySelector('#physical-point-type').value = details.physicalPoint?.type || '';
  document.querySelector('#physical-point-reference').value = details.physicalPoint?.reference || '';
  document.querySelector('#provisional-description').value = details.provisional?.description || '';
  document.querySelector('#provisional-brand').value = details.provisional?.brand || '';
  document.querySelector('#provisional-model').value = details.provisional?.model || '';
  document.querySelector('#provisional-serial').value = details.provisional?.serialNumber || '';
  document.querySelector('#provisional-observed-code').value = details.provisional?.observedCode || '';
  document.querySelector('#provisional-pending').checked = Boolean(details.provisional?.pendingIdentification);
  document.querySelector('#review-reason').value = details.review?.reason || '';
  document.querySelector('#review-detail').value = details.review?.detail || '';
  document.querySelector('#custody-destination').value = details.custody?.destination || '';
  document.querySelector('#custody-reference').value = details.custody?.reference || '';
  document.querySelector('#custody-basis').value = details.custody?.basis || '';
  elements.assetResultLabel.textContent = 'Corrección auditada';
  elements.assetName.textContent = observation.assetName || observation.provisionalCode;
  elements.assetResult.hidden = false;
  elements.observationForm.hidden = false;
  updateStructuredVisibility();
  elements.observationForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadSessionRecords() {
  const { observations } = await api(`/api/sessions/${state.sessionId}/observations`);
  const signature = JSON.stringify(observations.map(({ id, versionNumber, status }) => [id, versionNumber, status]));
  if (signature === state.recordsSignature) return;
  state.recordsSignature = signature;
  elements.sessionRecords.replaceChildren();
  for (const observation of observations) {
    const item = document.createElement('article');
    item.className = 'pending-item';
    const content = document.createElement('div');
    content.className = 'pending-item__content';
    const title = document.createElement('strong');
    title.textContent = `${observation.assetCode || observation.provisionalCode} · ${observation.assetName || 'Hallazgo adicional'}`;
    const status = document.createElement('p');
    status.textContent = `${resultLabel(observation.status)} · versión ${observation.versionNumber}`;
    content.append(title, status);
    const actions = document.createElement('div');
    actions.className = 'record-actions';
    const correct = document.createElement('button');
    correct.type = 'button'; correct.className = 'secondary'; correct.textContent = 'Corregir registro';
    const correctionReason = document.createElement('select');
    for (const [value, label] of [['error_clasificacion','Clasificación'],['error_dato','Dato observado'],['error_ubicacion','Ubicación'],['evidencia_incorrecta','Evidencia'],['otro','Otro motivo']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = `Corregir: ${label}`; correctionReason.append(option);
    }
    correct.addEventListener('click', () => loadObservationForCorrection(observation, correctionReason.value));
    const annul = document.createElement('button');
    annul.type = 'button'; annul.className = 'secondary secondary--warning'; annul.textContent = 'Anular';
    annul.addEventListener('click', async () => {
      if (!window.confirm('¿Anular este registro? La versión y su evidencia se conservarán en auditoría.')) return;
      try {
        await api(`/api/sessions/${state.sessionId}/observations/${observation.id}/correct`, {
          method: 'POST',
          body: JSON.stringify({ expectedObservationCode: observation.observationCode, action: 'annul', reasonCode: 'registro_equivocado', operatorCode: getOperatorCode(), deviceCode: getDeviceCode() }),
        });
        await updateProgress();
        setMessage('Registro anulado con trazabilidad.');
      } catch (error) { setMessage(error.message, true); }
    });
    const evidenceType = document.createElement('select');
    for (const [value, label] of [['bien_completo','Bien completo'],['etiqueta_patrimonial','Etiqueta'],['serie_modelo','Serie/modelo'],['dano','Daño'],['ubicacion','Ubicación']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; evidenceType.append(option);
    }
    const addEvidence = document.createElement('button');
    addEvidence.type = 'button'; addEvidence.className = 'secondary'; addEvidence.textContent = 'Agregar evidencia';
    addEvidence.addEventListener('click', () => {
      state.evidenceTarget = observation.id;
      const radio = elements.observationForm.querySelector(`input[name="evidence-type"][value="${evidenceType.value}"]`);
      if (radio) radio.checked = true;
      elements.evidenceFile.click();
    });
    const exceptionReason = document.createElement('select');
    for (const [value, label] of [['falla_tecnica','Falla técnica'],['restriccion_acceso','Restricción de acceso'],['riesgo_seguridad','Riesgo de seguridad'],['sin_elemento_visible','Elemento no visible']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = `Sin foto: ${label}`; exceptionReason.append(option);
    }
    const exceptEvidence = document.createElement('button');
    exceptEvidence.type = 'button'; exceptEvidence.className = 'secondary'; exceptEvidence.textContent = 'Justificar falta';
    exceptEvidence.addEventListener('click', async () => {
      if (!window.confirm(`¿Registrar una excepción auditada para “${evidenceType.options[evidenceType.selectedIndex].text}”?`)) return;
      try {
        await api(`/api/sessions/${state.sessionId}/observations/${observation.id}/evidence-exceptions`, {
          method: 'POST', body: JSON.stringify({ evidenceType: evidenceType.value, reasonCode: exceptionReason.value, confirm: true, operatorCode: getOperatorCode(), deviceCode: getDeviceCode() }),
        });
        setMessage('Excepción de evidencia registrada y auditada.');
      } catch (error) { setMessage(error.message, true); }
    });
    const manageEvidence = document.createElement('button');
    manageEvidence.type = 'button'; manageEvidence.className = 'secondary'; manageEvidence.textContent = 'Revisar evidencias';
    manageEvidence.addEventListener('click', async () => {
      try {
        const result = await api(`/api/sessions/${state.sessionId}/observations/${observation.id}/evidence`);
        const active = result.evidence || [];
        if (!active.length) { setMessage('Este registro no tiene evidencia activa.'); return; }
        const selected = active.length === 1 ? active[0] : active.find(({ id }) => String(id) === window.prompt(`ID a anular: ${active.map(({ id, type }) => `${id} (${type})`).join(', ')}`));
        if (!selected || !window.confirm(`¿Anular la evidencia ${selected.id} (${selected.type})? El archivo se conservará para auditoría.`)) return;
        await api(`/api/sessions/${state.sessionId}/observations/${observation.id}/evidence/${selected.id}/annul`, {
          method: 'POST', body: JSON.stringify({ reasonCode: 'evidencia_incorrecta', operatorCode: getOperatorCode(), deviceCode: getDeviceCode() }),
        });
        setMessage('Evidencia anulada con trazabilidad; el archivo histórico se conservó.');
      } catch (error) { setMessage(error.message, true); }
    });
    actions.append(correctionReason, correct, annul, evidenceType, addEvidence, exceptionReason, exceptEvidence, manageEvidence);
    item.append(content, actions);
    elements.sessionRecords.append(item);
  }
}

function renderClosureReadiness(readiness) {
  state.readiness = readiness;
  elements.closureMetrics.replaceChildren();
  const labels = [
    ['Esperados', 'expected'], ['Encontrados correctamente', 'correct'],
    ['Encontrados con incidencia', 'withIncidence'], ['Encontrados en otra ubicación', 'otherLocation'],
    ['No encontrados en terreno', 'notFound'], ['Bienes adicionales', 'additional'],
    ['Pendientes genéricos', 'pending'], ['Pendientes de identificar', 'pendingIdentification'],
    ['Incidencias', 'incidences'], ['Evidencias faltantes', 'missingEvidence'],
    ['Ambigüedades', 'ambiguities'], ['Revisiones pendientes', 'pendingReviews'],
  ];
  for (const [label, key] of labels) appendDetail(elements.closureMetrics, label, String(numericMetric(readiness.metrics[key])));
  elements.closureBlockers.replaceChildren();
  if (readiness.ready) {
    elements.closureState.textContent = '✅ LISTA PARA CERRAR';
    elements.closureState.className = 'closure-state closure-state--ready';
  } else {
    elements.closureState.textContent = `⛔ NO SALIR TODAVÍA — Faltan ${readiness.blockers.length} situaciones por resolver`;
    elements.closureState.className = 'closure-state closure-state--blocked';
    for (const blocker of readiness.blockers) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'closure-blocker';
      button.textContent = blocker.message;
      button.addEventListener('click', () => {
        elements.closurePanel.hidden = true;
        elements.workPanel.hidden = false;
        if (blocker.entity?.type === 'asset') document.querySelector('#pending-panel').open = true;
        else document.querySelector('#records-panel').open = true;
        (blocker.entity?.type === 'asset' ? elements.pendingAssets : elements.sessionRecords).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      elements.closureBlockers.append(button);
    }
  }
  elements.closureConfirm.checked = false;
  elements.closureConfirmLabel.hidden = !readiness.ready;
  elements.finalizeSession.disabled = true;
  elements.closurePanel.hidden = false;
  elements.workPanel.hidden = true;
}

elements.closeSession.addEventListener('click', async () => {
  try {
    const { readiness } = await api(`/api/sessions/${state.sessionId}/closure-readiness`);
    renderClosureReadiness(readiness);
  } catch (error) { setMessage(error.message, true); }
});

elements.dismissClosure.addEventListener('click', () => {
  elements.closurePanel.hidden = true;
  elements.workPanel.hidden = false;
  elements.lookupCode.focus();
});

elements.closureConfirm.addEventListener('change', () => {
  elements.finalizeSession.disabled = !(state.readiness?.ready && elements.closureConfirm.checked);
});

elements.finalizeSession.addEventListener('click', async () => {
  if (!state.readiness?.ready || !elements.closureConfirm.checked) return;
  try {
    const { summary } = await api(`/api/sessions/${state.sessionId}/close`, {
      method: 'POST',
      body: JSON.stringify({
        confirm: true,
        statement: 'field-review-complete',
        operatorCode: getOperatorCode(),
        deviceCode: getDeviceCode(),
      }),
    });
    elements.summaryDetails.replaceChildren();
    appendDetail(elements.summaryDetails, 'Bienes esperados', String(numericMetric(summary.bienesEsperados)));
    appendDetail(elements.summaryDetails, 'Encontrados correctamente', String(numericMetric(summary.bienesConformes)));
    appendDetail(elements.summaryDetails, 'Encontrados totales', String(numericMetric(summary.encontrados)));
    appendDetail(elements.summaryDetails, 'Datos distintos', String(numericMetric(summary.datosDistintos)));
    appendDetail(elements.summaryDetails, 'No ubicados', String(numericMetric(summary.noUbicados)));
    appendDetail(elements.summaryDetails, 'Diferencias de ubicación', String(numericMetric(summary.diferenciasUbicacion)));
    appendDetail(elements.summaryDetails, 'Hallazgos provisionales', String(numericMetric(summary.hallazgosProvisionales)));
    appendDetail(elements.summaryDetails, 'Problemas de identificación', String(numericMetric(summary.problemasIdentificacion)));
    appendDetail(elements.summaryDetails, 'Problemas de etiqueta', String(numericMetric(summary.problemasEtiqueta)));
    appendDetail(elements.summaryDetails, 'Sin etiqueta', String(numericMetric(summary.sinEtiqueta)));
    appendDetail(elements.summaryDetails, 'Pendientes de identificar', String(numericMetric(summary.pendientesIdentificar)));
    appendDetail(elements.summaryDetails, 'Datos no coincidentes', String(numericMetric(summary.datosNoCoincidentes)));
    appendDetail(elements.summaryDetails, 'Regulares', String(numericMetric(summary.regulares)));
    appendDetail(elements.summaryDetails, 'Malos', String(numericMetric(summary.malos)));
    appendDetail(elements.summaryDetails, 'No operativos', String(numericMetric(summary.noOperativos)));
    appendDetail(elements.summaryDetails, 'Incompletos', String(numericMetric(summary.incompletos)));
    appendDetail(elements.summaryDetails, 'Malos o no operativos', String(numericMetric(summary.malosNoOperativos)));
    appendDetail(elements.summaryDetails, 'Propuestas de baja', String(numericMetric(summary.propuestasBaja)));
    appendDetail(elements.summaryDetails, 'En reparación', String(numericMetric(summary.enReparacion)));
    appendDetail(elements.summaryDetails, 'Préstamos informados', String(numericMetric(summary.prestamosInformados)));
    appendDetail(elements.summaryDetails, 'Traslados no regularizados', String(numericMetric(summary.trasladosNoRegularizados)));
    appendDetail(elements.summaryDetails, 'Terceros / no municipales', String(numericMetric(summary.tercerosNoMunicipales)));
    appendDetail(elements.summaryDetails, 'No registrados', String(numericMetric(summary.noRegistrados)));
    appendDetail(elements.summaryDetails, 'Requieren revisión', String(numericMetric(summary.requiereRevision)));
    appendDetail(elements.summaryDetails, 'Incidencias con fotografía', String(numericMetric(summary.incidenciasConFoto)));
    appendDetail(elements.summaryDetails, 'Pendientes de revisión', String(numericMetric(summary.pendientesRevision)));
    appendDetail(elements.summaryDetails, 'Observaciones totales', String(numericMetric(summary.observacionesTotales)));
    appendDetail(elements.summaryDetails, 'Pendientes', String(numericMetric(summary.pendientes)));
    appendDetail(elements.summaryDetails, 'Porcentaje de revisión', `${numericMetric(summary.porcentajeRevision)}%`);
    appendDetail(elements.summaryDetails, 'Porcentaje de conformidad', `${numericMetric(summary.porcentajeConformidad)}%`);
    elements.summaryReportLink.href = `/reports?sessionId=${summary.id}`;
    elements.summaryPanel.hidden = false;
    elements.closurePanel.hidden = true;
    elements.workPanel.hidden = true;
    elements.pairingPanel.hidden = true;
    stopPolling();
    localStorage.removeItem(sessionStorageKey);
    state.sessionId = null;
    elements.startSession.disabled = false;
    setMessage('Sesión cerrada.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

try {
  elements.operatorCode.value = localStorage.getItem(operatorStorageKey) || elements.operatorCode.value;
  elements.operatorCode.addEventListener('change', () => localStorage.setItem(operatorStorageKey, getOperatorCode()));
  await api('/api/health');
  elements.connection.textContent = 'Servicio local activo';
  await loadLocations();
  await recoverStoredSession();
} catch (error) {
  elements.connection.textContent = 'Servicio no disponible';
  setMessage(error.message, true);
}
