import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const notebook = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile.js', import.meta.url), 'utf8');
const notebookHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

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

  test('notebook keeps the fast manual-first path and offers direct no-found actions', () => {
    const resolved = notebook.slice(
      notebook.indexOf('async function handleResolvedAsset'),
      notebook.indexOf('function showLookupChoice'),
    );
    const pending = notebook.slice(
      notebook.indexOf('async function loadPendingAssets'),
      notebook.indexOf("elements.closeSession.addEventListener"),
    );
    expect(resolved).toContain("registerObservation({ asset, status: 'verificado', lookupCode: code })");
    expect(notebook).toContain('elements.lookupCode.focus()');
    expect(notebook).toContain('Bien registrado. Listo para el siguiente código.');
    expect(pending).toContain("markMissing.textContent = 'No encontrado en terreno'");
    expect(pending).toContain('/not-found');
  });

  test('undo UI confirms the displayed last observation and refreshes operational state', () => {
    expect(notebookHtml).toContain('id="undo-last"');
    expect(notebookHtml).toContain('Deshacer último registro');
    expect(notebookHtml).toContain('id="undo-reason"');
    expect(notebookHtml).toContain('id="undo-confirm"');
    const undo = notebook.slice(
      notebook.indexOf("elements.undoForm.addEventListener('submit'"),
      notebook.indexOf('function resetEntryFlow'),
    );
    expect(undo).toContain('observationCode: candidate.observationCode');
    expect(undo).toContain('await updateProgress()');
    expect(undo).toContain('error.status === 409');
    expect(notebook).toContain("renderLastRecord(summary.lastObservation, summary.status === 'open')");
  });

  test('expired mobile links disable manual controls and hide invalid metrics', () => {
    expect(mobile).toContain('function disableExpiredLink');
    expect(mobile).toContain("elements.lookupForm.querySelectorAll('input, button')");
    expect(mobile).toContain('elements.incidenceMode.disabled = true');
    expect(mobile).toContain("elements.location.closest('.card').hidden = true");
    expect(mobile).toContain('error.status === 401');
  });

  test('productive mobile flow contains no camera runtime or persisted token', () => {
    expect(mobile).not.toMatch(/mobile-scanner|BarcodeDetector|ZXing|getUserMedia|startCamera/);
    expect(mobile).not.toMatch(/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:token|pairing)/i);
    expect(mobile).toContain("const mobileDeviceKey = 'inventario-terreno.mobileDeviceId'");
    expect(mobile).toContain("elements.lookupForm.addEventListener('submit'");
    expect(mobile).toContain('elements.code.focus()');
  });
});
