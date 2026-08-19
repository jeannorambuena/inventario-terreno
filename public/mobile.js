import {
  getFieldEvidencePolicy,
  validateFieldRequirements,
} from './field-rules.js';
import {
  createMobileDeviceSuffix,
  createPollingFailureTracker,
  createSafeNetworkError,
  isIntentionalAbort,
  temporaryConnectionMessage,
} from './mobile-polling.js';

const params = new URLSearchParams(location.search);
const sessionId = Number(params.get('sessionId'));
const token = params.get('token') ?? '';
const svgNamespace = 'http://www.w3.org/2000/svg';

const elements = {
  network: document.querySelector('#network-state'),
  location: document.querySelector('#session-location'),
  sessionState: document.querySelector('#session-state'),
  progress: document.querySelector('#progress'),
  progressLabel: document.querySelector('#progress-label'),
  conformanceLabel: document.querySelector('#conformance-label'),
  pendingLabel: document.querySelector('#pending-label'),
  progressPercent: document.querySelector('#progress-percent'),
  conformancePercent: document.querySelector('#conformance-percent'),
  lookupForm: document.querySelector('#lookup-form'),
  code: document.querySelector('#code'),
  incidenceMode: document.querySelector('#incidence-mode'),
  lastRecord: document.querySelector('#last-record'),
  lastCode: document.querySelector('#last-code'),
  lastName: document.querySelector('#last-name'),
  lastResult: document.querySelector('#last-result'),
  resultCard: document.querySelector('#result-card'),
  classification: document.querySelector('#classification'),
  assetName: document.querySelector('#asset-name'),
  assetDetails: document.querySelector('#asset-details'),
  matchChoices: document.querySelector('#match-choices'),
  observationForm: document.querySelector('#observation-form'),
  status: document.querySelector('#status'),
  addEvidence: document.querySelector('#add-evidence'),
  evidenceFile: document.querySelector('#evidence-file'),
  evidenceStatus: document.querySelector('#evidence-status'),
  evidenceQueue: document.querySelector('#mobile-evidence-queue'),
  cancelIncidence: document.querySelector('#cancel-incidence'),
  message: document.querySelector('#message'),
};

const state = {
  lookup: null,
  incidenceMode: false,
  pollTimer: null,
  pollRunning: false,
  pollController: null,
  sessionValid: true,
  registrationInProgress: false,
  lookupInProgress: false,
  pollingFailures: createPollingFailureTracker(),
  evidenceQueue: [],
};

const mobileDeviceKey = 'inventario-terreno.mobileDeviceId';

function getMobileDeviceCode() {
  let value = '';

  try {
    value = localStorage.getItem(mobileDeviceKey) || '';
  } catch {
    // localStorage may be unavailable in some mobile browser modes.
  }

  if (!value) {
    value = `MOVIL-${createMobileDeviceSuffix()}`;

    try {
      localStorage.setItem(mobileDeviceKey, value);
    } catch {
      // The identifier is still valid for the current operation.
    }
  }

  return value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

function setNetworkState(text) {
  const label = document.createElement('span');
  label.textContent = text;
  elements.network.replaceChildren(createIcon(text === 'Conectado' ? 'connected' : 'warning'), label);
}

async function api(path, options = {}, retries = 2) {
  const { silentNetwork = false, ...fetchOptions } = options;
  const hasFormData = fetchOptions.body instanceof FormData;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(path, {
        ...fetchOptions,
        headers: {
          ...(hasFormData ? {} : { 'Content-Type': 'application/json' }),
          Authorization: `Bearer ${token}`,
          ...(fetchOptions.headers ?? {}),
        },
      });

      const raw = await response.text();
      let body = {};

      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { raw };
        }
      }

      if (!response.ok) {
        let fallbackMessage = `El servidor rechaz? la operaci?n (HTTP ${response.status}).`;

        if (response.status === 413) {
          fallbackMessage = 'La fotograf?a supera el tama?o m?ximo permitido de 8 MB.';
        } else if (response.status === 400) {
          fallbackMessage = 'El servidor rechaz? los datos enviados. Revise los campos obligatorios.';
        } else if (response.status >= 500) {
          fallbackMessage = `Error interno del servidor (HTTP ${response.status}).`;
        }

        const serverMessage =
          typeof body.error === 'string' && body.error.trim()
            ? body.error.trim()
            : '';

        const error = new Error(serverMessage || fallbackMessage);
        error.status = response.status;
        error.body = body;
        throw error;
      }

      if (!silentNetwork) setNetworkState('Conectado');
      return body;
    } catch (error) {
      lastError = error;

      // Una respuesta HTTP v?lida no es una ca?da de red.
      if (error.status) break;
      if (isIntentionalAbort(error)) break;

      if (!silentNetwork) setNetworkState('Reconectando?');
      if (attempt < retries) await wait(600 * (attempt + 1));
    }
  }

  if (lastError?.status || isIntentionalAbort(lastError)) throw lastError;

  if (!silentNetwork) setNetworkState('Sin conexi?n');
  throw createSafeNetworkError();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function message(text = '', isError = false) {
  elements.message.replaceChildren();
  if (text) {
    const label = document.createElement('span');
    label.textContent = text;
    elements.message.append(createIcon(isError ? 'error' : 'success'), label);
  }
  elements.message.classList.toggle('error', isError);
}

function stopMobilePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.pollController?.abort();
  state.pollController = null;
  state.pollRunning = false;
}

function disableControls() {
  elements.lookupForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
  elements.observationForm.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
  elements.incidenceMode.disabled = true;
}

function disableExpiredLink(text = 'El enlace móvil expiró o fue revocado.') {
  state.pollingFailures.markTerminal();
  stopMobilePolling();
  state.sessionValid = false;
  state.lookup = null;
  disableControls();
  elements.resultCard.hidden = true;
  elements.lookupForm.closest('.card').hidden = true;
  elements.location.closest('.card').hidden = true;
  message(text, true);
}

function disableEndedSession(status) {
  state.pollingFailures.markTerminal();
  stopMobilePolling();
  state.sessionValid = false;
  disableControls();
  const label = status === 'cancelled' ? 'cancelada' : 'cerrada';
  elements.sessionState.textContent = `Sesión ${label}`;
  message(`La sesión fue ${label} desde el notebook. No se pueden registrar más cambios.`, true);
}

function disableUnauthorizedAccess() {
  state.pollingFailures.markTerminal();
  stopMobilePolling();
  state.sessionValid = false;
  disableControls();
  message('Acceso no autorizado a la sesión móvil. Solicite un nuevo enlace en el notebook.', true);
}

function handleMobileError(error) {
  if (error.status === 401) {
    const detail = String(error.body?.error ?? '');
    const label = /revocado/i.test(detail) ? 'revocado' : /expirado/i.test(detail) ? 'expirado' : 'no válido';
    disableExpiredLink(`El enlace móvil está ${label}. Solicite un nuevo código QR en el notebook.`);
  } else if (error.status === 403) {
    disableUnauthorizedAccess();
  } else if (error.status === 410) {
    disableEndedSession(error.body?.sessionStatus);
  } else {
    message(error.message, true);
  }
}

function detail(label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'detail-item';
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value || '—';
  wrapper.append(term, description);
  elements.assetDetails.append(wrapper);
}

function renderSummary(summary) {
  const reviewed = number(summary.bienesEsperadosRevisados);
  const conforming = number(summary.bienesConformes);
  const total = number(summary.bienesEsperados);
  const percent = number(summary.porcentajeRevision);
  const pending = number(summary.pendientes);
  const conformancePercent = number(summary.porcentajeConformidad);
  elements.progress.value = percent;
  elements.progressLabel.textContent = `${reviewed} de ${total} bienes revisados`;
  elements.conformanceLabel.textContent = `${conforming} encontrados correctamente`;
  elements.pendingLabel.textContent = `${pending} pendientes`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.conformancePercent.textContent = `${conformancePercent}% de conformidad`;
}

function setIncidenceMode(active) {
  state.incidenceMode = active;
  elements.incidenceMode.setAttribute('aria-pressed', String(active));
  elements.incidenceMode.classList.toggle('incidence-action--active', active);
  setButtonContent(elements.incidenceMode, 'warning', active ? 'Incidencia activa' : 'Incidencia');
}

function renderLastRecord({ code, name, result }) {
  elements.lastCode.textContent = code || '—';
  elements.lastName.textContent = name || 'Bien sin descripción';
  elements.lastResult.textContent = result;
  elements.lastRecord.hidden = false;
}

function resetEntryFlow() {
  elements.lookupForm.reset();
  elements.observationForm.reset();
  elements.status.disabled = false;
  elements.evidenceStatus.textContent = '';
  elements.evidenceQueue.replaceChildren();
  elements.resultCard.hidden = true;
  state.lookup = null;
  for (const item of state.evidenceQueue) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  state.evidenceQueue = [];
  setIncidenceMode(false);
  elements.code.focus();
}

async function registerObservation({ lookup, status, observation = '' }) {
  if (state.registrationInProgress) return;
  state.registrationInProgress = true;
  try {
    const result = await api(`/api/sessions/${sessionId}/mobile-observations`, {
      method: 'POST',
      body: JSON.stringify({
        code: lookup.code,
        assetId: lookup.asset?.id,
        status,
        observation,
        observedAt: new Date().toISOString(),
        deviceCode: getMobileDeviceCode(),
      }),
    }, 0);
    renderSummary(result.summary);
    renderLastRecord({
      code: lookup.asset?.assetCode || lookup.code,
      name: lookup.asset?.name || 'Bien físico no registrado',
      result: status === 'verificado' ? 'Encontrado en ubicación correcta' : 'Incidencia registrada',
    });
    resetEntryFlow();
    message(status === 'verificado' ? 'Bien registrado. Listo para el siguiente código.' : 'Incidencia registrada.');
  } finally {
    state.registrationInProgress = false;
  }
}

function showIncidence(lookup) {
  state.lookup = lookup;
  const { asset, classification } = lookup;
  elements.status.disabled = false;
  document.querySelector('#mobile-provisional-fields').hidden = Boolean(asset);
  document.querySelector('#mobile-discrepancy-fields').hidden = classification !== 'corresponde';
  if (!asset) document.querySelector('#mobile-provisional-description').focus();
  elements.assetDetails.replaceChildren();
  elements.matchChoices.replaceChildren();
  elements.classification.className = 'classification';
  elements.observationForm.hidden = false;
  if (classification === 'corresponde') {
    elements.classification.classList.add('classification--warning');
    elements.classification.textContent = 'Incidencia en bien encontrado';
    elements.status.value = 'dato_distinto';
  } else if (classification === 'otra_ubicacion') {
    elements.classification.classList.add('classification--warning');
    elements.classification.textContent = 'Pertenece a otra ubicación';
    elements.status.value = 'otra_ubicacion';
    elements.observationForm.querySelector('input[name="situation"][value="otra_ubicacion"]').checked = true;
  } else {
    elements.classification.classList.add('classification--unknown');
    elements.classification.textContent = 'Bien no encontrado en el inventario maestro';
    elements.status.value = 'desconocido';
    elements.status.disabled = true;
    elements.observationForm.querySelector('input[name="situation"][value="bien_no_registrado"]').checked = true;
  }
  elements.assetName.textContent = asset?.name || 'Bien no encontrado en el inventario maestro';
  detail('Código del bien', asset?.assetCode || lookup.code);
  if (asset) {
    detail('Código escáner', asset.scannerCode);
    detail('Marca', asset.brand);
    detail('Modelo', asset.model);
  }
  elements.resultCard.hidden = false;
  elements.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleLookup(lookup) {
  if (lookup.ambiguous) {
    elements.classification.className = 'classification classification--warning';
    elements.classification.textContent = 'Código con múltiples coincidencias';
    elements.assetName.textContent = 'Seleccione el bien correcto';
    elements.assetDetails.replaceChildren();
    elements.matchChoices.replaceChildren();
    elements.observationForm.hidden = true;
    for (const match of lookup.matches) {
      const button = document.createElement('button');
      button.type = 'button';
      setButtonContent(button, 'inventory', `${match.assetCode} — ${match.name} · ${match.section || '—'} · ${match.alreadyObserved ? 'Ya revisado' : 'Pendiente'}`);
      button.disabled = match.alreadyObserved;
      button.addEventListener('click', () => {
        void handleLookup({ ...lookup, asset: match, matches: [match], ambiguous: false, classification: match.classification, alreadyObserved: match.alreadyObserved });
      });
      elements.matchChoices.append(button);
    }
    elements.resultCard.hidden = false;
    message('Seleccione una coincidencia pendiente. Una ya revisada no bloquea las demás.', true);
    return;
  }
  if (lookup.alreadyObserved) {
    state.lookup = null;
    elements.resultCard.hidden = true;
    message('Este bien ya fue observado en la sesión.', true);
    return;
  }
  if (lookup.classification === 'corresponde' && !state.incidenceMode) {
    await registerObservation({ lookup, status: 'verificado' });
    return;
  }
  setIncidenceMode(true);
  showIncidence(lookup);
  message(lookup.classification === 'otra_ubicacion'
    ? 'El bien pertenece a otra ubicación. Complete la incidencia.'
    : 'Complete la incidencia antes de registrar.');
}

async function loadSession(code = '', { signal, retries = 2, silentNetwork = false } = {}) {
  const query = code ? `?q=${encodeURIComponent(code)}` : '';
  const result = await api(`/api/sessions/${sessionId}/mobile${query}`, { signal, silentNetwork }, retries);
  elements.location.textContent = [result.session.direction, result.session.department, result.session.section]
    .filter(Boolean).join(' / ') || 'Sin ubicación especificada';
  elements.sessionState.textContent = result.session.status === 'open' ? 'Sesión abierta' : `Sesión ${result.session.status}`;
  renderSummary(result.summary);
  if (result.lookup) await handleLookup(result.lookup);
  return result;
}

async function pollMobileSession() {
  if (!state.sessionValid || state.pollRunning || state.registrationInProgress || state.lookupInProgress) return;
  state.pollRunning = true;
  state.pollController = new AbortController();
  try {
    await loadSession('', { signal: state.pollController.signal, retries: 0, silentNetwork: true });
    const recovery = state.pollingFailures.recordSuccess();
    setNetworkState('Conectado');
    if (recovery.action === 'clear-warning' && elements.message.textContent === temporaryConnectionMessage) message('');
  } catch (error) {
    const failure = state.pollingFailures.recordFailure(error);
    if (failure.action === 'terminal') handleMobileError(error);
    else if (failure.action === 'warn') {
      setNetworkState('Reconectando…');
      message(failure.message, true);
    }
  } finally {
    state.pollController = null;
    state.pollRunning = false;
  }
}

function startMobilePolling() {
  if (!state.sessionValid || state.pollTimer) return;
  state.pollTimer = setInterval(pollMobileSession, 2500);
}

elements.incidenceMode.addEventListener('click', () => {
  setIncidenceMode(true);

  if (state.lookup) {
    showIncidence(state.lookup);
  } else {
    const lookup = {
      code: '',
      asset: null,
      matches: [],
      ambiguous: false,
      classification: 'desconocido',
      alreadyObserved: false,
    };

    showIncidence(lookup);
    document.querySelector('#mobile-label').value = 'sin_etiqueta';
  }

  message(state.lookup?.asset
    ? 'Clasifique la excepci?n.'
    : 'Hallazgo sin c?digo. Describa el bien y el sistema generar? un identificador provisional.');
});

elements.cancelIncidence.addEventListener('click', () => {
  resetEntryFlow();
  message('Incidencia cancelada. No se registró ningún cambio.');
});

elements.addEvidence.addEventListener('click', () => {
  const type = elements.observationForm.querySelector('input[name="evidence-type"]:checked');
  if (!type) {
    message('Seleccione primero qué muestra la fotografía.', true);
    return;
  }
  elements.evidenceFile.click();
});

elements.evidenceFile.addEventListener('change', () => {
  const type = elements.observationForm.querySelector('input[name="evidence-type"]:checked')?.value;
  if (!type) return;
  for (const file of [...(elements.evidenceFile.files || [])]) {
    state.evidenceQueue.push({ file, type, previewUrl: URL.createObjectURL(file) });
  }
  elements.evidenceFile.value = '';
  elements.evidenceQueue.replaceChildren();
  for (const { file, type: evidenceType, previewUrl } of state.evidenceQueue) {
    const item = document.createElement('span');
    item.className = 'evidence-chip';
    const preview = document.createElement('img');
    preview.src = previewUrl; preview.alt = ''; preview.className = 'evidence-chip__preview';
    const label = document.createElement('span');
    label.textContent = `✓ ${evidenceType.replaceAll('_', ' ')} · ${file.name}`;
    item.append(preview, label);
    elements.evidenceQueue.append(item);
  }
  elements.evidenceStatus.textContent = `${state.evidenceQueue.length} fotografía(s) preparada(s). Puede agregar otra.`;
});

function mobileFieldDetails() {
  const situations = [...elements.observationForm.querySelectorAll('input[name="situation"]:checked')].map(({ value }) => value);
  const physicalCondition = document.querySelector('#mobile-physical').value;
  const discrepancyVisible = !document.querySelector('#mobile-discrepancy-fields').hidden;
  return {
    label: document.querySelector('#mobile-label').value,
    physicalCondition,
    functionality: document.querySelector('#mobile-functionality').value,
    proposedDisposal: document.querySelector('#mobile-disposal').checked,
    situations,
    physicalPoint: { type: document.querySelector('#mobile-point').value, reference: document.querySelector('#mobile-point-reference').value },
    provisional: {
      description: document.querySelector('#mobile-provisional-description').value,
      brand: document.querySelector('#mobile-provisional-brand').value,
      model: document.querySelector('#mobile-provisional-model').value,
      serialNumber: document.querySelector('#mobile-provisional-serial').value,
      observedCode: state.lookup?.code || '',
      pendingIdentification: document.querySelector('#mobile-pending-identification').checked,
    },
    discrepancies: discrepancyVisible ? [{
      field: document.querySelector('#mobile-discrepancy-field').value,
      masterValue: '',
      observedValue: document.querySelector('#mobile-discrepancy-value').value,
      pendingFromEvidence: document.querySelector('#mobile-discrepancy-evidence').checked,
    }] : [],
    incomplete: { parts: physicalCondition === 'incompleto' && document.querySelector('#mobile-incomplete-part').value ? [document.querySelector('#mobile-incomplete-part').value] : [], other: '' },
    review: { reason: document.querySelector('#mobile-review-reason').value, detail: '' },
    custody: { destination: document.querySelector('#mobile-custody-destination').value, reference: document.querySelector('#mobile-custody-reference').value, basis: document.querySelector('#mobile-custody-basis').value },
  };
}

function mobileLegacySelections(details) {
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

async function uploadMobileEvidence(observationId, items) {
  for (const { file, type } of items) {
    const form = new FormData();
    form.append('evidenceType', type);
    form.append('deviceCode', getMobileDeviceCode());
    form.append('evidence', file);
    await api(`/api/sessions/${sessionId}/mobile-observations/${observationId}/evidence`, { method: 'POST', body: form }, 0);
  }
}

elements.lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.code.value.trim();
  if (!code || state.lookupInProgress) return;
  state.lookupInProgress = true;
  try {
    await loadSession(code);
  } catch (error) {
    handleMobileError(error);
  } finally {
    state.lookupInProgress = false;
  }
});

function mobileElementForField(field) {
  const selectors = {
    label: '#mobile-label',
    physicalCondition: '#mobile-physical',
    functionality: '#mobile-functionality',
    situations: 'input[name="situation"]',
    'provisional.description': '#mobile-provisional-description',
    'physicalPoint.type': '#mobile-point',
    'physicalPoint.reference': '#mobile-point-reference',
    discrepancies: '#mobile-discrepancy-value',
    'incomplete.parts': '#mobile-incomplete-part',
    'incomplete.other': '#mobile-incomplete-part',
    'custody.destination': '#mobile-custody-destination',
    'custody.basis': '#mobile-custody-basis',
    'review.reason': '#mobile-review-reason',
  };

  return selectors[field]
    ? elements.observationForm.querySelector(selectors[field])
    : null;
}

function validateMobileIncidence(details) {
  const errors = validateFieldRequirements({
    assetId: state.lookup?.asset?.id || null,
    status: elements.status.value,
    details,
    isIncidence: true,
  }).map((error) => ({
    ...error,
    element: mobileElementForField(error.field),
  }));

  const evidencePolicy = getFieldEvidencePolicy({
    assetId: state.lookup?.asset?.id || null,
    status: elements.status.value,
    details,
  });

  const evidenceTypes = new Set(
    state.evidenceQueue.map(({ type }) => type),
  );

  for (const requiredType of evidencePolicy.required) {
    if (!evidenceTypes.has(requiredType)) {
      const label = {
        bien_completo: 'Bien completo',
        etiqueta_patrimonial: 'Etiqueta patrimonial',
        serie_modelo: 'Serie / modelo',
        dano: 'Da?o',
        ubicacion: 'Ubicaci?n',
      }[requiredType] || requiredType;

      errors.push({
        code: `missing_evidence_${requiredType}`,
        field: `evidence.${requiredType}`,
        section: 'evidence',
        message: `Falta evidencia obligatoria: ${label}.`,
        element: elements.addEvidence,
      });
    }
  }

  for (const { file } of state.evidenceQueue) {
    if (file.size > 8 * 1024 * 1024) {
      errors.push({
        code: 'evidence_too_large',
        field: 'evidence',
        section: 'evidence',
        message:
          `La fotograf?a ${file.name} supera el m?ximo de 8 MB.`,
        element: elements.addEvidence,
      });
      break;
    }

    if (
      !['image/jpeg', 'image/png', 'image/webp']
        .includes(file.type)
    ) {
      errors.push({
        code: 'invalid_evidence_type',
        field: 'evidence',
        section: 'evidence',
        message:
          `La fotograf?a ${file.name} debe ser JPEG, PNG o WebP.`,
        element: elements.addEvidence,
      });
      break;
    }
  }

  return errors;
}

function showMobileValidationError(error) {
  message(error.message, true);

  if (error.element) {
    error.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (
      typeof error.element.focus === 'function'
      && !error.element.disabled
    ) {
      error.element.focus({ preventScroll: true });
    }
  }
}

elements.observationForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (state.registrationInProgress) return;

  if (!state.lookup) {
    message('No hay un bien o hallazgo activo para registrar.', true);
    return;
  }

  const submitButton = elements.observationForm.querySelector('button[type="submit"]');

  message('Validando incidencia?');

  const details = mobileFieldDetails();


  const validationErrors = validateMobileIncidence(details);

  if (validationErrors.length > 0) {
    showMobileValidationError(validationErrors[0]);
    return;
  }

  const selections = mobileLegacySelections(details);
  const body = new FormData();

  if (state.lookup.asset) {
    body.append('assetId', String(state.lookup.asset.id));
  }

  body.append('status', elements.status.value);
  body.append('identification', JSON.stringify(selections.identification));
  body.append('physical', JSON.stringify(selections.physical));
  body.append('situation', JSON.stringify(selections.situation));
  body.append('details', JSON.stringify(details));
  body.append('deviceCode', getMobileDeviceCode());

  const firstEvidence = state.evidenceQueue[0];

  if (firstEvidence) {
    body.append('evidenceType', firstEvidence.type);
    body.append('evidence', firstEvidence.file);
  }

  state.registrationInProgress = true;
  submitButton.disabled = true;
  setButtonContent(submitButton, 'check', 'Guardando?');
  message('Guardando incidencia?');

  try {
    const lookup = state.lookup;

    const result = await api(
      `/api/sessions/${sessionId}/mobile-incidences`,
      {
        method: 'POST',
        body,
      },
      0,
    );

    if (state.evidenceQueue.length > 1) {
      await uploadMobileEvidence(
        result.observation.id,
        state.evidenceQueue.slice(1),
      );
    }

    const registeredCode =
      result.observation.provisionalCode
      || lookup.asset?.assetCode
      || lookup.code
      || 'Sin c?digo';

    renderSummary(result.summary);

    renderLastRecord({
      code: registeredCode,
      name:
        lookup.asset?.name
        || details.provisional.description
        || 'Bien f?sico no registrado',
      result: 'Incidencia registrada',
    });

    resetEntryFlow();

    message(
      `Incidencia guardada correctamente: ${registeredCode}. Listo para continuar.`,
    );
  } catch (error) {
    handleMobileError(error);
  } finally {
    state.registrationInProgress = false;
    submitButton.disabled = false;
    setButtonContent(submitButton, 'check', 'Guardar incidencia');
  }
});

window.addEventListener('offline', () => {
  stopMobilePolling();
  setNetworkState('Sin conexión');
  message('Compruebe que el teléfono y notebook estén en la misma red local y que una VPN/WireGuard no esté desviando la conexión.', true);
});
window.addEventListener('online', async () => {
  if (!state.sessionValid) return;
  try {
    await loadSession();
    state.pollingFailures.recordSuccess();
    setNetworkState('Conectado');
    startMobilePolling();
  } catch (error) { handleMobileError(error); }
});
window.addEventListener('pagehide', () => {
  stopMobilePolling();
  for (const item of state.evidenceQueue) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
});

if (!Number.isInteger(sessionId) || sessionId <= 0 || !token) {
  disableExpiredLink('El enlace móvil no es válido o está incompleto.');
} else {
  try {
    await loadSession();
    startMobilePolling();
    elements.code.focus();
  } catch (error) {
    handleMobileError(error);
  }
}
