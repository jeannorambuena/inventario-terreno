import {
  createPollingFailureTracker,
  createSafeNetworkError,
  isIntentionalAbort,
  temporaryConnectionMessage,
} from './mobile-polling.js';
import {
  createDetectionGate,
  getCameraEnhancements,
  getCentralScanRegion,
  getNativeOneDimensionalFormats,
  getScannerFeedback,
  getZxingOneDimensionalFormats,
} from './mobile-scanner.js';

const params = new URLSearchParams(location.search);
const sessionId = Number(params.get('sessionId'));
const token = params.get('token') ?? '';

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
  cameraButton: document.querySelector('#camera-button'),
  cameraMessage: document.querySelector('#camera-message'),
  cameraPanel: document.querySelector('#camera-panel'),
  cameraPreview: document.querySelector('#camera-preview'),
  cameraSearchState: document.querySelector('#camera-search-state'),
  analyzeCode: document.querySelector('#analyze-code'),
  toggleTorch: document.querySelector('#toggle-torch'),
  zoomControl: document.querySelector('#zoom-control'),
  cameraZoom: document.querySelector('#camera-zoom'),
  stopCamera: document.querySelector('#stop-camera'),
  resultCard: document.querySelector('#result-card'),
  classification: document.querySelector('#classification'),
  assetName: document.querySelector('#asset-name'),
  assetDetails: document.querySelector('#asset-details'),
  matchChoices: document.querySelector('#match-choices'),
  observationForm: document.querySelector('#observation-form'),
  status: document.querySelector('#status'),
  notes: document.querySelector('#notes'),
  message: document.querySelector('#message'),
};

const state = {
  lookup: null,
  cameraControls: null,
  zxingReader: null,
  nativeDetector: null,
  cameraTrack: null,
  decodeTimer: null,
  decodeBusy: false,
  scanAttempt: 0,
  feedbackTimers: [],
  torchOn: false,
  manualAnalysisInProgress: false,
  cameraRunId: 0,
  stream: null,
  scanning: false,
  pollTimer: null,
  pollRunning: false,
  pollController: null,
  sessionValid: true,
  registrationInProgress: false,
  lookupInProgress: false,
  pollingFailures: createPollingFailureTracker(),
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function setNetworkState(text) {
  const label = document.createElement('span');
  label.textContent = text;
  const iconName = text === 'Conectado' ? 'connected' : 'warning';
  elements.network.replaceChildren(createIcon(iconName), label);
}

async function api(path, options = {}, retries = 2) {
  const { silentNetwork = false, ...fetchOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(path, {
        ...fetchOptions,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(fetchOptions.headers ?? {}),
        },
      });
      const body = await response.json();
      if (!response.ok) {
        const error = new Error(body.error || 'No fue posible completar la operación.');
        error.status = response.status;
        error.body = body;
        throw error;
      }
      if (!silentNetwork) setNetworkState('Conectado');
      return body;
    } catch (error) {
      lastError = error;
      if (error.status === 401 || error.status === 403 || error.status === 410 || isIntentionalAbort(error)) break;
      if (!silentNetwork) setNetworkState('Reconectando…');
      if (attempt < retries) await wait(600 * (attempt + 1));
    }
  }
  if (lastError?.status === 401 || lastError?.status === 403 || lastError?.status === 410 || isIntentionalAbort(lastError)) throw lastError;
  if (!silentNetwork) setNetworkState('Sin conexión');
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

function disableExpiredLink(text = 'El enlace móvil expiró o fue revocado.') {
  state.pollingFailures.markTerminal();
  stopMobilePolling();
  state.sessionValid = false;
  stopCamera();
  state.lookup = null;
  elements.lookupForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
  elements.cameraButton.disabled = true;
  elements.code.disabled = true;
  elements.resultCard.hidden = true;
  elements.lookupForm.closest('.card').hidden = true;
  elements.location.closest('.card').hidden = true;
  message(text, true);
}

function disableEndedSession(status) {
  state.pollingFailures.markTerminal();
  stopMobilePolling();
  stopCamera();
  state.sessionValid = false;
  elements.lookupForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
  elements.observationForm.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
  elements.cameraButton.disabled = true;
  elements.code.disabled = true;
  const label = status === 'cancelled' ? 'cancelada' : 'cerrada';
  elements.sessionState.textContent = `Sesión ${label}`;
  message(`La sesión fue ${label} desde el notebook. No se pueden registrar más cambios.`, true);
}

function disableUnauthorizedAccess() {
  state.pollingFailures.markTerminal();
  stopMobilePolling();
  stopCamera();
  state.sessionValid = false;
  elements.lookupForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
  elements.observationForm.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
  elements.cameraButton.disabled = true;
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
  elements.conformanceLabel.textContent = `${conforming} bienes conformes`;
  elements.pendingLabel.textContent = `${pending} pendientes`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.conformancePercent.textContent = `${conformancePercent}% de conformidad`;
}

function stopMobilePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.pollController?.abort();
  state.pollController = null;
  state.pollRunning = false;
}

async function pollMobileSession() {
  if (!state.sessionValid || state.pollRunning || state.registrationInProgress || state.lookupInProgress || state.scanning) return;
  state.pollRunning = true;
  state.pollController = new AbortController();
  try {
    await loadSession('', { signal: state.pollController.signal, retries: 0, silentNetwork: true });
    recordConnectionRecovery();
  } catch (error) {
    const failure = state.pollingFailures.recordFailure(error);
    if (failure.action === 'terminal') {
      handleMobileError(error);
    } else if (failure.action === 'warn') {
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

function recordConnectionRecovery() {
  const recovery = state.pollingFailures.recordSuccess();
  setNetworkState('Conectado');
  if (recovery.action === 'clear-warning' && elements.message.textContent === temporaryConnectionMessage) {
    message('');
  }
}

function renderLookup(lookup, code) {
  state.lookup = { ...lookup, code };
  const { asset, classification } = lookup;
  const verifiedOption = elements.status.querySelector('option[value="verificado"]');
  verifiedOption.disabled = false;
  elements.notes.required = false;
  elements.status.disabled = false;
  elements.assetDetails.replaceChildren();
  elements.matchChoices.replaceChildren();
  elements.classification.className = 'classification';
  if (lookup.alreadyObserved) {
    state.lookup = null;
    elements.resultCard.hidden = true;
    message('Este bien ya fue observado en la sesión.', true);
    return;
  }
  if (lookup.ambiguous) {
    elements.classification.classList.add('classification--warning');
    elements.classification.textContent = 'Código con múltiples coincidencias';
    elements.assetName.textContent = 'Seleccione el bien correcto';
    elements.observationForm.hidden = true;
    for (const match of lookup.matches) {
      const button = document.createElement('button');
      button.type = 'button';
      const label = document.createElement('span');
      label.textContent = `${match.assetCode} — ${match.name}`;
      button.append(createIcon('inventory'), label);
      button.addEventListener('click', () => renderLookup({
        asset: match,
        matches: [match],
        ambiguous: false,
        classification: match.classification,
        alreadyObserved: match.alreadyObserved,
      }, code));
      elements.matchChoices.append(button);
    }
    elements.resultCard.hidden = false;
    return;
  }
  elements.observationForm.hidden = false;
  if (classification === 'corresponde') {
    elements.classification.classList.add('classification--success');
    elements.classification.textContent = 'Corresponde a esta ubicación';
    elements.status.value = 'verificado';
  } else if (classification === 'otra_ubicacion') {
    elements.classification.classList.add('classification--warning');
    elements.classification.textContent = 'Pertenece a otra ubicación';
    elements.status.value = 'otra_ubicacion';
    verifiedOption.disabled = true;
  } else {
    elements.classification.classList.add('classification--unknown');
    elements.classification.textContent = 'Hallazgo provisional desconocido';
    elements.status.value = 'desconocido';
    elements.status.disabled = true;
    elements.notes.required = true;
  }
  elements.notes.required = elements.status.value !== 'verificado';
  elements.assetName.textContent = asset?.name || 'Código no registrado';
  detail('Código del bien', asset?.assetCode || code);
  if (asset) {
    detail('Código escáner', asset.scannerCode);
    detail('Marca', asset.brand);
    detail('Modelo', asset.model);
  }
  elements.resultCard.hidden = false;
}

elements.status.addEventListener('change', () => {
  elements.notes.required = elements.status.value !== 'verificado';
});

async function loadSession(code = '', { signal, retries = 2, silentNetwork = false } = {}) {
  const query = code ? `?q=${encodeURIComponent(code)}` : '';
  const result = await api(`/api/sessions/${sessionId}/mobile${query}`, { signal, silentNetwork }, retries);
  elements.location.textContent = [result.session.direction, result.session.department, result.session.section]
    .filter(Boolean).join(' / ') || 'Sin ubicación especificada';
  elements.sessionState.textContent = result.session.status === 'open' ? 'Sesión abierta' : `Sesión ${result.session.status}`;
  renderSummary(result.summary);
  if (result.lookup) renderLookup(result.lookup, code);
  return result;
}

elements.lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.code.value.trim();
  if (!code) return;
  state.lookupInProgress = true;
  try {
    await loadSession(code);
    message('Código consultado.');
  } catch (error) {
    handleMobileError(error);
  } finally {
    state.lookupInProgress = false;
  }
});

elements.observationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.lookup) return;
  stopCamera();
  const submit = elements.observationForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  state.registrationInProgress = true;
  try {
    const result = await api(`/api/sessions/${sessionId}/mobile-observations`, {
      method: 'POST',
      body: JSON.stringify({
        code: state.lookup.code,
        assetId: state.lookup.asset?.id,
        status: elements.status.value,
        observation: elements.notes.value,
        observedAt: new Date().toISOString(),
      }),
    }, 0);
    renderSummary(result.summary);
    elements.lookupForm.reset();
    elements.observationForm.reset();
    elements.status.disabled = false;
    elements.notes.required = false;
    elements.resultCard.hidden = true;
    state.lookup = null;
    elements.code.focus();
    message('Observación registrada.');
  } catch (error) {
    handleMobileError(error);
  } finally {
    state.registrationInProgress = false;
    submit.disabled = false;
  }
});

const detectionGate = createDetectionGate((rawValue) => {
  void acceptScannedCode(rawValue);
});

function clearScannerFeedbackTimers() {
  for (const timer of state.feedbackTimers) clearTimeout(timer);
  state.feedbackTimers = [];
}

function stopAnalysis() {
  state.scanning = false;
  detectionGate.stop();
  if (state.decodeTimer) clearTimeout(state.decodeTimer);
  state.decodeTimer = null;
  state.decodeBusy = false;
  state.cameraControls?.stop?.();
  state.cameraControls = null;
  clearScannerFeedbackTimers();
}

function stopCamera({ announce = false } = {}) {
  state.cameraRunId += 1;
  stopAnalysis();
  state.nativeDetector = null;
  state.manualAnalysisInProgress = false;
  state.zxingReader = null;
  for (const track of state.stream?.getTracks?.() ?? []) track.stop();
  state.stream = null;
  state.cameraTrack = null;
  state.torchOn = false;
  state.scanAttempt = 0;
  elements.cameraPreview.pause();
  elements.cameraPreview.srcObject = null;
  elements.cameraPanel.classList.remove('camera-panel--detected');
  elements.cameraPanel.hidden = true;
  elements.analyzeCode.hidden = true;
  elements.toggleTorch.hidden = true;
  elements.toggleTorch.querySelector('span').textContent = 'Encender luz';
  elements.zoomControl.hidden = true;
  if (announce) elements.cameraMessage.textContent = 'Cámara cerrada.';
}

async function acceptScannedCode(code) {
  if (!code) return;
  const exactCode = String(code);
  stopAnalysis();
  elements.cameraPanel.classList.add('camera-panel--detected');
  elements.cameraSearchState.textContent = `Código detectado: ${exactCode}`;
  navigator.vibrate?.(70);
  playDetectionTone();
  await wait(180);
  stopCamera();
  elements.code.value = exactCode;
  elements.cameraMessage.textContent = `Código detectado: ${exactCode}`;
  try {
    await loadSession(exactCode);
    message(`Código detectado: ${exactCode}`);
  } catch (error) {
    handleMobileError(error);
  }
}

function playDetectionTone() {
  try {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.07);
    oscillator.addEventListener('ended', () => { void context.close(); }, { once: true });
  } catch {
    // El sonido es opcional y nunca bloquea el flujo.
  }
}

function createZxingReader() {
  const supported = getZxingOneDimensionalFormats(globalThis.ZXingBrowser);
  if (supported.length === 0) return null;
  try {
    const Reader = globalThis.ZXingBrowser.BrowserMultiFormatReader;
    const hints = new Map([
      [2, supported.map(({ value }) => value)], // POSSIBLE_FORMATS
      [3, true], // TRY_HARDER
    ]);
    return new Reader(hints, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 400 });
  } catch {
    return null;
  }
}

function destroyCanvas(canvas) {
  const context = canvas.getContext('2d');
  context?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

function applyAdaptiveThreshold(canvas, { radius = 15, offset = 15 } = {}) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  if (!context || !width || !height) return false;

  const imageData = context.getImageData(0, 0, width, height);
  const source = imageData.data;
  const gray = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < source.length; i += 4, p += 1) {
    gray[p] = Math.round(
      source[i] * 0.299 +
      source[i + 1] * 0.587 +
      source[i + 2] * 0.114
    );
  }

  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * stride + x] =
        integral[(y - 1) * stride + x] + rowSum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);

      const a = integral[y1 * stride + x1];
      const b = integral[y1 * stride + (x2 + 1)];
      const c = integral[(y2 + 1) * stride + x1];
      const d = integral[(y2 + 1) * stride + (x2 + 1)];

      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const mean = (d - b - c + a) / area;
      const value = gray[y * width + x] < mean - offset ? 0 : 255;
      const index = (y * width + x) * 4;

      source[index] = value;
      source[index + 1] = value;
      source[index + 2] = value;
      source[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return true;
}

function captureCurrentFrame(fullFrame = false) {
  const videoWidth = elements.cameraPreview.videoWidth;
  const videoHeight = elements.cameraPreview.videoHeight;
  if (!videoWidth || !videoHeight) return null;
  const region = getCentralScanRegion(videoWidth, videoHeight, fullFrame);
  const canvas = document.createElement('canvas');
  const maxDimension = 1000;
  const scale = Math.min(1, maxDimension / Math.max(region.width, region.height));
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    destroyCanvas(canvas);
    return null;
  }
  context.drawImage(
    elements.cameraPreview,
    region.x, region.y, region.width, region.height,
    0, 0, canvas.width, canvas.height,
  );
  return canvas;
}

function decodeCurrentFrame({ fullFrame = false } = {}) {
  const canvas = captureCurrentFrame(fullFrame);
  if (!canvas || !state.zxingReader) return undefined;

  try {
    try {
      const direct = state.zxingReader.decodeFromCanvas(canvas)?.getText?.();
      if (direct !== undefined) return direct;
    } catch {
      // Si la imagen cruda no alcanza, aplicar contraste adaptativo local.
    }

    if (!applyAdaptiveThreshold(canvas)) return undefined;
    return state.zxingReader.decodeFromCanvas(canvas)?.getText?.();
  } catch {
    return undefined;
  } finally {
    destroyCanvas(canvas);
  }
}

function scheduleZxingAnalysis(runId, delay = 180) {
  if (!state.scanning || runId !== state.cameraRunId || !state.zxingReader) return;
  state.decodeTimer = setTimeout(() => {
    if (!state.scanning || runId !== state.cameraRunId || state.decodeBusy) return;
    state.decodeBusy = true;
    try {
      state.scanAttempt += 1;
      const rawValue = decodeCurrentFrame({ fullFrame: state.scanAttempt % 6 === 0 });
      if (rawValue !== undefined) detectionGate.accept(rawValue);
    } finally {
      state.decodeBusy = false;
    }
    scheduleZxingAnalysis(runId);
  }, delay);
}

function scheduleNativeAnalysis(runId) {
  if (!state.scanning || runId !== state.cameraRunId || !state.nativeDetector) return;
  state.decodeTimer = setTimeout(async () => {
    if (!state.scanning || runId !== state.cameraRunId || state.decodeBusy) return;
    state.decodeBusy = true;
    try {
      const barcodes = await state.nativeDetector.detect(elements.cameraPreview);
      if (barcodes[0]?.rawValue !== undefined) detectionGate.accept(barcodes[0].rawValue);
    } catch {
      stopCamera();
      elements.cameraMessage.textContent = 'Formato de código no compatible. Puede ingresar el código manualmente.';
      return;
    } finally {
      state.decodeBusy = false;
    }
    scheduleNativeAnalysis(runId);
  }, 180);
}

function scheduleScannerFeedback(runId) {
  elements.cameraSearchState.textContent = getScannerFeedback(0);
  state.feedbackTimers = [
    setTimeout(() => {
      if (state.scanning && runId === state.cameraRunId) {
        elements.cameraSearchState.textContent = getScannerFeedback(5000);
      }
    }, 5000),
    setTimeout(() => {
      if (state.scanning && runId === state.cameraRunId) elements.analyzeCode.hidden = false;
    }, 7000),
    setTimeout(() => {
      if (state.scanning && runId === state.cameraRunId) {
        elements.cameraSearchState.textContent = getScannerFeedback(10000);
      }
    }, 10000),
  ];
}

async function configureCameraCapabilities(track) {
  let capabilities = {};
  try { capabilities = track?.getCapabilities?.() ?? {}; } catch { capabilities = {}; }
  const enhancements = getCameraEnhancements(capabilities);
  elements.toggleTorch.hidden = !enhancements.torch;
  elements.zoomControl.hidden = !enhancements.zoom;
  if (enhancements.zoom) {
    elements.cameraZoom.min = String(enhancements.zoom.min);
    elements.cameraZoom.max = String(enhancements.zoom.max);
    elements.cameraZoom.step = String(enhancements.zoom.step);
    elements.cameraZoom.value = String(track.getSettings?.().zoom ?? enhancements.zoom.min);
  }
  const optionalConstraints = [];
  if (enhancements.continuousFocus) optionalConstraints.push({ focusMode: 'continuous' });
  if (enhancements.continuousExposure) optionalConstraints.push({ exposureMode: 'continuous' });
  for (const constraint of optionalConstraints) {
    try { await track.applyConstraints({ advanced: [constraint] }); } catch { /* Mejora opcional. */ }
  }
}

async function requestRearCamera() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
      },
    });
  } catch (error) {
    if (error.name !== 'OverconstrainedError' && error.name !== 'TypeError') throw error;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  }
  const track = stream.getVideoTracks()[0];
  await configureCameraCapabilities(track);
  return stream;
}

async function startCamera() {
  stopCamera();
  state.scanning = true;
  detectionGate.start();
  const runId = state.cameraRunId;
  elements.cameraPanel.hidden = false;
  elements.cameraPanel.classList.remove('camera-panel--detected');
  elements.cameraMessage.textContent = 'La imagen se analiza solo en este teléfono y no se guarda.';
  elements.analyzeCode.hidden = true;
  elements.cameraSearchState.textContent = getScannerFeedback(0);
  state.stream = await requestRearCamera();
  if (!state.scanning || runId !== state.cameraRunId) return;
  state.cameraTrack = state.stream.getVideoTracks()[0];
  elements.cameraPreview.srcObject = state.stream;
  await elements.cameraPreview.play();

  state.zxingReader = createZxingReader();
  if (state.zxingReader) {
    scheduleScannerFeedback(runId);
    scheduleZxingAnalysis(runId, 0);
    return;
  }
  const nativeFormats = await getNativeOneDimensionalFormats(globalThis.BarcodeDetector);
  if (nativeFormats.length === 0) throw new DOMException('Unsupported scanner', 'NotSupportedError');
  state.nativeDetector = new BarcodeDetector({ formats: nativeFormats });
  scheduleScannerFeedback(runId);
  scheduleNativeAnalysis(runId);
}

async function analyzeCurrentFrame() {
  if (!state.scanning || state.manualAnalysisInProgress || !state.stream) return;
  state.manualAnalysisInProgress = true;
  const runId = state.cameraRunId;
  if (state.decodeTimer) clearTimeout(state.decodeTimer);
  state.decodeTimer = null;
  elements.cameraSearchState.textContent = 'Analizando fotograma…';
  let rawValue;
  try {
    if (state.zxingReader) {
      rawValue = decodeCurrentFrame() ?? decodeCurrentFrame({ fullFrame: true });
    } else if (state.nativeDetector) {
      const barcodes = await state.nativeDetector.detect(elements.cameraPreview);
      rawValue = barcodes[0]?.rawValue;
    }
    if (rawValue !== undefined) {
      detectionGate.accept(rawValue);
      if (detectionGate.active) {
        await wait(120);
        const confirmation = state.zxingReader
          ? decodeCurrentFrame()
          : (await state.nativeDetector.detect(elements.cameraPreview))[0]?.rawValue;
        if (confirmation !== undefined) detectionGate.accept(confirmation);
      }
    }
    if (!detectionGate.active) return;
    elements.cameraMessage.textContent = 'No se pudo reconocer el código. Acerque la etiqueta y evite reflejos.';
  } catch {
    elements.cameraMessage.textContent = 'Formato de código no compatible.';
  } finally {
    state.manualAnalysisInProgress = false;
    if (state.scanning && runId === state.cameraRunId) {
      elements.cameraSearchState.textContent = getScannerFeedback(0);
      if (state.zxingReader) scheduleZxingAnalysis(runId);
      else scheduleNativeAnalysis(runId);
    }
  }
}

elements.cameraButton.addEventListener('click', async () => {
  elements.cameraMessage.textContent = 'Comprobando acceso a la cámara…';
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    elements.cameraMessage.textContent = 'La cámara está bloqueada porque esta URL HTTP por IP no es un contexto seguro. Puede escribir o pegar el código manualmente.';
    elements.code.focus();
    return;
  }
  stopCamera();
  state.scanning = true;
  try {
    await startCamera();
  } catch (error) {
    stopCamera();
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      elements.cameraMessage.textContent = 'El permiso de cámara fue denegado. Puede escribir o pegar el código manualmente.';
    } else if (error.message.includes('ZXing') || error.name === 'NotSupportedError') {
      elements.cameraMessage.textContent = 'Este navegador no soporta el lector de cámara. Puede escribir o pegar el código manualmente.';
    } else {
      elements.cameraMessage.textContent = 'No fue posible iniciar la cámara. Puede escribir o pegar el código manualmente.';
    }
    elements.code.focus();
  }
});

elements.analyzeCode.addEventListener('click', () => { void analyzeCurrentFrame(); });
elements.toggleTorch.addEventListener('click', async () => {
  if (!state.scanning || !state.cameraTrack) return;
  const nextState = !state.torchOn;
  try {
    await state.cameraTrack.applyConstraints({ advanced: [{ torch: nextState }] });
    state.torchOn = nextState;
    elements.toggleTorch.querySelector('span').textContent = nextState ? 'Apagar luz' : 'Encender luz';
  } catch {
    elements.cameraSearchState.textContent = 'No fue posible cambiar la luz. Continúe con la lectura manual.';
  }
});
elements.cameraZoom.addEventListener('input', async () => {
  if (!state.scanning || !state.cameraTrack) return;
  try {
    await state.cameraTrack.applyConstraints({ advanced: [{ zoom: Number(elements.cameraZoom.value) }] });
  } catch {
    elements.zoomControl.hidden = true;
  }
});
elements.stopCamera.addEventListener('click', () => stopCamera({ announce: true }));
window.addEventListener('offline', () => {
  stopMobilePolling();
  setNetworkState('Sin conexión');
});
window.addEventListener('online', async () => {
  if (!state.sessionValid) return;
  try {
    await loadSession();
    recordConnectionRecovery();
    startMobilePolling();
  } catch (error) { handleMobileError(error); }
});
window.addEventListener('pagehide', () => {
  stopMobilePolling();
  stopCamera();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
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
