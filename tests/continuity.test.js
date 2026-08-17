import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const notebook = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile.js', import.meta.url), 'utf8');

describe('notebook and mobile continuity safeguards', () => {
  test('reload recovery stores only the session id and rejects closed sessions', () => {
    expect(notebook).toContain("const sessionStorageKey = 'inventario-terreno.sessionId'");
    expect(notebook).toContain('localStorage.setItem(sessionStorageKey, String(summary.id))');
    expect(notebook).toContain("summary.status !== 'open'");
    expect(notebook).toContain('localStorage.removeItem(sessionStorageKey)');
    expect(notebook).not.toMatch(/localStorage\.(?:setItem|getItem)\([^\n]*(?:token|pairing)/i);
  });

  test('polling refreshes summary and pending assets without resetting active forms', () => {
    expect(notebook).toContain('setInterval(pollSession, 2500)');
    const updateProgress = notebook.slice(
      notebook.indexOf('async function updateProgress()'),
      notebook.indexOf('function choosePendingAsset'),
    );
    expect(updateProgress).toContain('loadPendingAssets()');
    expect(updateProgress).not.toMatch(/lookupForm\.reset|observationForm\.reset|lookupCode\.value|observationNotes\.value/);
  });

  test('expired mobile links disable manual and camera controls and hide invalid metrics', () => {
    expect(mobile).toContain('function disableExpiredLink');
    expect(mobile).toContain('elements.cameraButton.disabled = true');
    expect(mobile).toContain('elements.code.disabled = true');
    expect(mobile).toContain("elements.location.closest('.card').hidden = true");
    expect(mobile).toContain('error.status === 401');
  });

  test('camera activation always gives immediate feedback and specific fallbacks', () => {
    expect(mobile).toContain('Comprobando acceso a la cámara');
    expect(mobile).toContain('no es un contexto seguro');
    expect(mobile).toContain('El permiso de cámara fue denegado');
    expect(mobile).toContain('no soporta el lector de cámara');
    expect(mobile).toContain('escribir o pegar el código manualmente');
  });
});
