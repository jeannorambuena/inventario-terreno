const elements = {
  connection: document.querySelector('#connection-status'),
  direction: document.querySelector('#direction'),
  department: document.querySelector('#department'),
  section: document.querySelector('#section'),
  startSession: document.querySelector('#start-session'),
  resumePanel: document.querySelector('#resume-panel'),
  resumeSessions: document.querySelector('#resume-sessions'),
  workPanel: document.querySelector('#work-panel'),
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
  observationNotes: document.querySelector('#observation-notes'),
  progress: document.querySelector('#progress'),
  progressLabel: document.querySelector('#progress-label'),
  conformanceLabel: document.querySelector('#conformance-label'),
  progressPercent: document.querySelector('#progress-percent'),
  pendingCount: document.querySelector('#pending-count'),
  pendingAssets: document.querySelector('#pending-assets'),
  summaryPanel: document.querySelector('#summary-panel'),
  summaryDetails: document.querySelector('#summary-details'),
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
  pollTimer: null,
  pollRunning: false,
  pairingRunning: false,
  cancelSession: null,
};

const sessionStorageKey = 'inventario-terreno.sessionId';
const svgNamespace = 'http://www.w3.org/2000/svg';

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
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
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

function observationRequired(status) {
  return status !== 'verificado';
}

elements.observationStatus.addEventListener('change', () => {
  elements.observationNotes.required = observationRequired(elements.observationStatus.value);
});

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
      body: JSON.stringify({ locationId: state.locationId }),
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
  const verifiedOption = elements.observationStatus.querySelector('option[value="verificado"]');
  elements.observationStatus.disabled = false;
  verifiedOption.disabled = false;
  elements.observationNotes.required = false;
  elements.assetResultLabel.textContent = asset ? 'Bien encontrado' : 'Hallazgo provisional';
  elements.assetName.textContent = asset?.name || 'Sin coincidencia en el inventario';
  if (asset) {
    appendDetail(elements.assetDetails, 'Código del bien', asset.assetCode);
    appendDetail(elements.assetDetails, 'Código escáner', asset.scannerCode);
    appendDetail(elements.assetDetails, 'Marca', asset.brand);
    appendDetail(elements.assetDetails, 'Modelo', asset.model);
    appendDetail(elements.assetDetails, 'Serie', asset.serialNumber);
    if (asset.locationId === state.locationId) {
      elements.observationStatus.value = 'verificado';
    } else {
      elements.observationStatus.value = 'otra_ubicacion';
      verifiedOption.disabled = true;
    }
  } else {
    appendDetail(elements.assetDetails, 'Código ingresado', provisionalCode);
    elements.observationStatus.value = 'desconocido';
    elements.observationStatus.disabled = true;
    elements.observationNotes.required = true;
  }
  elements.observationNotes.required = observationRequired(elements.observationStatus.value);
  elements.assetResult.hidden = false;
  elements.observationForm.hidden = false;
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
    setButtonContent(button, 'inventory', `${asset.assetCode} — ${asset.name}`);
    button.addEventListener('click', () => showAsset(asset, null));
    elements.assetDetails.append(button);
  }
}

elements.lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.lookupCode.value.trim();
  if (!code) return;
  try {
    const { asset, lookup } = await api(`/api/assets/by-code/${encodeURIComponent(code)}?sessionId=${state.sessionId}`);
    if (lookup?.alreadyObserved) {
      elements.assetResult.hidden = true;
      elements.observationForm.hidden = true;
      setMessage('Este bien ya fue observado en la sesión.', true);
      return;
    }
    if (lookup?.ambiguous) {
      showLookupChoice(lookup);
      setMessage('Seleccione una de las coincidencias antes de registrar.');
      return;
    }
    showAsset(asset, null);
    setMessage('Bien encontrado.');
  } catch (error) {
    if (error.message === 'Bien no encontrado.') {
      showAsset(null, code);
      setMessage('Hallazgo provisional: agregue una observación obligatoria.');
    } else {
      setMessage(error.message, true);
    }
  }
});

elements.observationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api(`/api/sessions/${state.sessionId}/observations`, {
      method: 'POST',
      body: JSON.stringify({
        assetId: state.asset?.id ?? null,
        provisionalCode: state.provisionalCode,
        status: elements.observationStatus.value,
        locationId: state.locationId,
        observation: elements.observationNotes.value,
        observedAt: new Date().toISOString(),
      }),
    });
    elements.lookupForm.reset();
    elements.observationForm.reset();
    elements.observationStatus.disabled = false;
    elements.observationNotes.required = false;
    elements.assetResult.hidden = true;
    elements.observationForm.hidden = true;
    state.asset = null;
    state.provisionalCode = null;
    await updateProgress();
    elements.lookupCode.focus();
    setMessage('Observación registrada.');
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
  elements.progress.value = progressPercent;
  elements.progress.textContent = `${progressPercent}%`;
  elements.progressLabel.textContent = `${reviewed} de ${totalAssets} bienes revisados`;
  elements.conformanceLabel.textContent = `${conforming} bienes conformes`;
  elements.progressPercent.textContent = `${progressPercent}%`;
  await loadPendingAssets();
  return summary;
}

function choosePendingAsset(asset, status) {
  showAsset(asset, null);
  elements.observationStatus.value = status;
  elements.observationNotes.required = observationRequired(status);
  elements.observationNotes.focus();
}

async function loadPendingAssets() {
  const { assets } = await api(`/api/sessions/${state.sessionId}/pending-assets`);
  elements.pendingCount.textContent = String(assets.length);
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
    const actions = document.createElement('div');
    actions.className = 'pending-actions';
    for (const [label, status, iconName] of [['Verificado', 'verificado', 'check'], ['No ubicado', 'no_ubicado', 'missing'], ['Dato distinto', 'dato_distinto', 'edit']]) {
      const button = document.createElement('button');
      button.type = 'button';
      setButtonContent(button, iconName, label);
      button.addEventListener('click', () => choosePendingAsset(asset, status));
      actions.append(button);
    }
    item.append(content, actions);
    elements.pendingAssets.append(item);
  }
}

elements.closeSession.addEventListener('click', async () => {
  try {
    const { summary } = await api(`/api/sessions/${state.sessionId}/close`, { method: 'POST' });
    elements.summaryDetails.replaceChildren();
    appendDetail(elements.summaryDetails, 'Bienes esperados', String(numericMetric(summary.bienesEsperados)));
    appendDetail(elements.summaryDetails, 'Bienes revisados', String(numericMetric(summary.bienesEsperadosRevisados)));
    appendDetail(elements.summaryDetails, 'Bienes conformes', String(numericMetric(summary.bienesConformes)));
    appendDetail(elements.summaryDetails, 'Datos distintos', String(numericMetric(summary.datosDistintos)));
    appendDetail(elements.summaryDetails, 'No ubicados', String(numericMetric(summary.noUbicados)));
    appendDetail(elements.summaryDetails, 'Diferencias de ubicación', String(numericMetric(summary.diferenciasUbicacion)));
    appendDetail(elements.summaryDetails, 'Hallazgos provisionales', String(numericMetric(summary.hallazgosProvisionales)));
    appendDetail(elements.summaryDetails, 'Observaciones totales', String(numericMetric(summary.observacionesTotales)));
    appendDetail(elements.summaryDetails, 'Pendientes', String(numericMetric(summary.pendientes)));
    appendDetail(elements.summaryDetails, 'Porcentaje de revisión', `${numericMetric(summary.porcentajeRevision)}%`);
    appendDetail(elements.summaryDetails, 'Porcentaje de conformidad', `${numericMetric(summary.porcentajeConformidad)}%`);
    elements.summaryPanel.hidden = false;
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
  await api('/api/health');
  elements.connection.textContent = 'Servicio local activo';
  await loadLocations();
  await recoverStoredSession();
} catch (error) {
  elements.connection.textContent = 'Servicio no disponible';
  setMessage(error.message, true);
}
