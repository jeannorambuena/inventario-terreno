const params = new URLSearchParams(location.search);
const sessionId = Number(params.get('sessionId'));
const token = params.get('token') ?? '';

const elements = {
  network: document.querySelector('#network-state'),
  location: document.querySelector('#session-location'),
  progress: document.querySelector('#progress'),
  progressLabel: document.querySelector('#progress-label'),
  conformanceLabel: document.querySelector('#conformance-label'),
  progressPercent: document.querySelector('#progress-percent'),
  lookupForm: document.querySelector('#lookup-form'),
  code: document.querySelector('#code'),
  cameraButton: document.querySelector('#camera-button'),
  cameraMessage: document.querySelector('#camera-message'),
  cameraPanel: document.querySelector('#camera-panel'),
  cameraPreview: document.querySelector('#camera-preview'),
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

const state = { lookup: null, cameraControls: null, stream: null, scanning: false };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function api(path, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.headers ?? {}),
        },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No fue posible completar la operación.');
      elements.network.textContent = 'Conectado';
      return body;
    } catch (error) {
      lastError = error;
      elements.network.textContent = 'Reconectando…';
      if (attempt < retries) await wait(600 * (attempt + 1));
    }
  }
  elements.network.textContent = 'Sin conexión';
  throw lastError;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function message(text = '', isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle('error', isError);
}

function detail(label, value) {
  const wrapper = document.createElement('div');
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
  elements.progress.value = percent;
  elements.progressLabel.textContent = `${reviewed} de ${total} bienes revisados`;
  elements.conformanceLabel.textContent = `${conforming} bienes conformes`;
  elements.progressPercent.textContent = `${percent}%`;
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
  if (lookup.alreadyObserved) {
    state.lookup = null;
    elements.resultCard.hidden = true;
    message('Este bien ya fue observado en la sesión.', true);
    return;
  }
  if (lookup.ambiguous) {
    elements.classification.textContent = 'Código con múltiples coincidencias';
    elements.assetName.textContent = 'Seleccione el bien correcto';
    elements.observationForm.hidden = true;
    for (const match of lookup.matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${match.assetCode} — ${match.name}`;
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
    elements.classification.textContent = 'Corresponde a esta ubicación';
    elements.status.value = 'verificado';
  } else if (classification === 'otra_ubicacion') {
    elements.classification.textContent = 'Pertenece a otra ubicación';
    elements.status.value = 'otra_ubicacion';
    verifiedOption.disabled = true;
  } else {
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

async function loadSession(code = '') {
  const query = code ? `?q=${encodeURIComponent(code)}` : '';
  const result = await api(`/api/sessions/${sessionId}/mobile${query}`);
  elements.location.textContent = [result.session.direction, result.session.department, result.session.section]
    .filter(Boolean).join(' / ') || 'Sin ubicación especificada';
  renderSummary(result.summary);
  if (result.lookup) renderLookup(result.lookup, code);
  return result;
}

elements.lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.code.value.trim();
  if (!code) return;
  try {
    await loadSession(code);
    message('Código consultado.');
  } catch (error) {
    message(error.message, true);
  }
});

elements.observationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.lookup) return;
  const submit = elements.observationForm.querySelector('button[type="submit"]');
  submit.disabled = true;
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
    message(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

function stopCamera() {
  state.scanning = false;
  state.cameraControls?.stop?.();
  state.cameraControls = null;
  for (const track of state.stream?.getTracks?.() ?? []) track.stop();
  state.stream = null;
  elements.cameraPreview.srcObject = null;
  elements.cameraPanel.hidden = true;
}

async function acceptScannedCode(code) {
  if (!code || !state.scanning) return;
  stopCamera();
  elements.code.value = code;
  await loadSession(code);
  message('Código detectado por la cámara.');
}

async function scanWithBarcodeDetector() {
  const detector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'] });
  state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  elements.cameraPreview.srcObject = state.stream;
  await elements.cameraPreview.play();
  const detect = async () => {
    if (!state.scanning) return;
    const barcodes = await detector.detect(elements.cameraPreview);
    if (barcodes[0]?.rawValue) return acceptScannedCode(barcodes[0].rawValue);
    requestAnimationFrame(detect);
  };
  requestAnimationFrame(detect);
}

async function scanWithZxing() {
  const Reader = globalThis.ZXingBrowser?.BrowserMultiFormatReader;
  if (!Reader) throw new Error('ZXing local no está disponible.');
  const reader = new Reader();
  state.cameraControls = await reader.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    elements.cameraPreview,
    (result) => {
      if (result?.getText()) acceptScannedCode(result.getText());
    },
  );
}

elements.cameraButton.addEventListener('click', async () => {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    elements.cameraMessage.textContent = 'El navegador bloquea la cámara en HTTP. Use la entrada manual o habilite un contexto seguro local.';
    elements.code.focus();
    return;
  }
  stopCamera();
  state.scanning = true;
  elements.cameraPanel.hidden = false;
  elements.cameraMessage.textContent = 'La imagen se procesa solo en este teléfono y no se guarda.';
  try {
    if ('BarcodeDetector' in globalThis) {
      try {
        await scanWithBarcodeDetector();
        return;
      } catch {
        stopCamera();
        state.scanning = true;
        elements.cameraPanel.hidden = false;
      }
    }
    await scanWithZxing();
  } catch (error) {
    stopCamera();
    elements.cameraMessage.textContent = `No fue posible usar la cámara: ${error.message}. La entrada manual sigue disponible.`;
  }
});

elements.stopCamera.addEventListener('click', stopCamera);
window.addEventListener('offline', () => { elements.network.textContent = 'Sin conexión'; });
window.addEventListener('online', async () => {
  try { await loadSession(); } catch { /* el reintento visual permanece activo */ }
});
window.addEventListener('pagehide', stopCamera);

if (!Number.isInteger(sessionId) || sessionId <= 0 || !token) {
  message('El enlace de emparejamiento no es válido.', true);
  elements.lookupForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
} else {
  try {
    await loadSession();
    elements.code.focus();
  } catch (error) {
    message(error.message, true);
  }
}
