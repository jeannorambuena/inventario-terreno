const elements = {
  connection: document.querySelector('#connection-status'),
  direction: document.querySelector('#direction'),
  department: document.querySelector('#department'),
  section: document.querySelector('#section'),
  startSession: document.querySelector('#start-session'),
  workPanel: document.querySelector('#work-panel'),
  closeSession: document.querySelector('#close-session'),
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
  progressPercent: document.querySelector('#progress-percent'),
  summaryPanel: document.querySelector('#summary-panel'),
  summaryDetails: document.querySelector('#summary-details'),
  message: document.querySelector('#message'),
};

const state = {
  locations: [],
  locationId: null,
  sessionId: null,
  sessionStarting: false,
  asset: null,
  provisionalCode: null,
};

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No fue posible completar la operación.');
  return body;
}

function setMessage(message = '', error = false) {
  elements.message.textContent = message;
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
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value || '—';
  wrapper.append(term, detail);
  container.append(wrapper);
}

async function loadLocations() {
  const { locations } = await api('/api/locations');
  state.locations = locations;
  setOptions(elements.direction, distinct(locations.map(({ direction }) => direction)));
}

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

elements.section.addEventListener('change', () => {
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
});

elements.startSession.addEventListener('click', async () => {
  if (!state.locationId || state.sessionId || state.sessionStarting) return;
  state.sessionStarting = true;
  elements.startSession.disabled = true;
  try {
    const { session } = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ locationId: state.locationId }),
    });
    state.sessionId = session.id;
    elements.workPanel.hidden = false;
    elements.summaryPanel.hidden = true;
    elements.startSession.disabled = true;
    await updateProgress();
    elements.lookupCode.focus();
    setMessage('Sesión iniciada.');
  } catch (error) {
    elements.startSession.disabled = !state.locationId;
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
  elements.assetResult.hidden = false;
  elements.observationForm.hidden = false;
}

elements.lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.lookupCode.value.trim();
  if (!code) return;
  try {
    const { asset } = await api(`/api/assets/by-code/${encodeURIComponent(code)}`);
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
  elements.progress.value = summary.progressPercent;
  elements.progress.textContent = `${summary.progressPercent}%`;
  elements.progressLabel.textContent = `${summary.verifiedExpected} de ${summary.totalAssets} verificados`;
  elements.progressPercent.textContent = `${summary.progressPercent}%`;
  return summary;
}

elements.closeSession.addEventListener('click', async () => {
  try {
    const { summary } = await api(`/api/sessions/${state.sessionId}/close`, { method: 'POST' });
    elements.summaryDetails.replaceChildren();
    appendDetail(elements.summaryDetails, 'Bienes esperados', String(summary.totalAssets));
    appendDetail(elements.summaryDetails, 'Observaciones', String(summary.observationCount));
    appendDetail(elements.summaryDetails, 'Bienes esperados verificados', String(summary.verifiedExpected));
    appendDetail(elements.summaryDetails, 'Diferencias de ubicación', String(summary.locationDifferences));
    appendDetail(elements.summaryDetails, 'Hallazgos provisionales', String(summary.provisionalFindings));
    appendDetail(elements.summaryDetails, 'Pendientes', String(summary.pending));
    appendDetail(elements.summaryDetails, 'Avance', `${summary.progressPercent}%`);
    elements.summaryPanel.hidden = false;
    elements.workPanel.hidden = true;
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
} catch (error) {
  elements.connection.textContent = 'Servicio no disponible';
  setMessage(error.message, true);
}
