export const priorityOneDimensionalFormats = [
  'code_128',
  'code_39',
  'codabar',
  'itf',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
];

const zxingFormatNames = {
  code_128: 'CODE_128',
  code_39: 'CODE_39',
  codabar: 'CODABAR',
  itf: 'ITF',
  ean_13: 'EAN_13',
  ean_8: 'EAN_8',
  upc_a: 'UPC_A',
  upc_e: 'UPC_E',
};

export async function getNativeOneDimensionalFormats(BarcodeDetectorClass) {
  if (!BarcodeDetectorClass?.getSupportedFormats) return [];
  try {
    const supported = await BarcodeDetectorClass.getSupportedFormats();
    return priorityOneDimensionalFormats.filter((format) => supported.includes(format));
  } catch {
    return [];
  }
}

export function getZxingOneDimensionalFormats(zxing) {
  if (!zxing?.BrowserMultiFormatReader || !zxing?.BarcodeFormat) return [];
  return priorityOneDimensionalFormats
    .map((name) => ({ name, value: zxing.BarcodeFormat[zxingFormatNames[name]] }))
    .filter(({ value }) => value !== undefined);
}

export function createDetectionGate(onDetection, {
  requiredMatches = 2,
  confirmationWindowMs = 1400,
  now = Date.now,
} = {}) {
  let active = false;
  let accepted = false;
  let candidate = null;
  let candidateCount = 0;
  let lastCandidateAt = 0;

  return {
    start() {
      active = true;
      accepted = false;
      candidate = null;
      candidateCount = 0;
      lastCandidateAt = 0;
    },
    stop() {
      active = false;
    },
    accept(rawValue) {
      if (!active || accepted || rawValue === null || rawValue === undefined) return false;
      const exactValue = String(rawValue);
      if (!exactValue.trim()) return false;
      const detectedAt = now();
      if (exactValue === candidate && detectedAt - lastCandidateAt <= confirmationWindowMs) {
        candidateCount += 1;
      } else {
        candidate = exactValue;
        candidateCount = 1;
      }
      lastCandidateAt = detectedAt;
      if (candidateCount < requiredMatches) return false;
      accepted = true;
      active = false;
      onDetection(exactValue);
      return true;
    },
    get active() {
      return active;
    },
  };
}

export const scannerFeedback = Object.freeze({
  searching: 'Buscando código…',
  steady: 'Mantenga la etiqueta quieta y evite reflejos.',
  manual: 'No pudimos leerla. Limpie el lente, acerque la etiqueta o ingrese el código manualmente.',
});

export function getScannerFeedback(elapsedMs) {
  if (elapsedMs >= 10000) return scannerFeedback.manual;
  if (elapsedMs >= 5000) return scannerFeedback.steady;
  return scannerFeedback.searching;
}

export function getCameraEnhancements(capabilities = {}) {
  const zoom = capabilities.zoom;
  return {
    torch: capabilities.torch === true,
    zoom: zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max)
      ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 }
      : null,
    continuousFocus: capabilities.focusMode?.includes?.('continuous') ?? false,
    continuousExposure: capabilities.exposureMode?.includes?.('continuous') ?? false,
  };
}

export function getCentralScanRegion(width, height, fullFrame = false) {
  if (fullFrame) return { x: 0, y: 0, width, height };
  return {
    x: Math.round(width * 0.07),
    y: Math.round(height * 0.34),
    width: Math.round(width * 0.86),
    height: Math.round(height * 0.32),
  };
}

export function createFallbackSwitch({ delayMs = 2500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  return {
    schedule(callback) {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

export function createLookupCodeVariants(value) {
  const exact = String(value ?? '').trim();
  if (!exact) return [];
  const variants = new Set([exact]);
  const municipal = exact.match(/^(\d{2})-(\d{2})-(\d{5})$/);
  if (municipal) {
    const compact = `${municipal[1]}${municipal[2]}${municipal[3]}`;
    variants.add(compact);
    variants.add(compact.padStart(10, '0'));
  } else if (/^\d{9}$/.test(exact)) {
    variants.add(exact.padStart(10, '0'));
    variants.add(`${exact.slice(0, 2)}-${exact.slice(2, 4)}-${exact.slice(4)}`);
  } else if (/^0\d{9}$/.test(exact)) {
    const municipalDigits = exact.slice(1);
    variants.add(municipalDigits);
    variants.add(`${municipalDigits.slice(0, 2)}-${municipalDigits.slice(2, 4)}-${municipalDigits.slice(4)}`);
  }
  return [...variants];
}
