import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  latestOperationalBackup,
  restoreOperationalBackup,
  verifyOperationalBackup,
} from '../src/database/operational-backup.js';

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

export function runRecoveryDrill({
  backupDir = latestOperationalBackup(),
  keep = false,
} = {}) {
  if (!backupDir) throw new Error('No existe un backup operacional para el drill.');
  const source = resolve(backupDir);
  const sourceVerification = verifyOperationalBackup(source);
  if (sourceVerification.status !== 'PASS') {
    throw new Error('El backup fuente no supera la verificacion previa.');
  }

  const drillRoot = mkdtempSync(join(tmpdir(), 'inventario-recovery-drill-'));
  const targetRoot = join(drillRoot, 'instalacion-restaurada');
  let result;

  try {
    result = restoreOperationalBackup({
      backupDir: source,
      targetRoot,
      confirm: true,
    });
    if (result.status !== 'PASS') throw new Error('La restauracion temporal no termino en PASS.');

    return {
      status: 'PASS',
      source,
      drillRoot,
      targetRoot,
      cleaned: !keep,
      manifest: result.manifest,
      verification: result.verification,
    };
  } finally {
    if (!keep && basename(drillRoot).startsWith('inventario-recovery-drill-')) {
      rmSync(drillRoot, { recursive: true, force: true });
    }
  }
}

function printResult(result) {
  const checks = result.verification.checks;
  const statusFor = (name) => checks.find((check) => check.name === name)?.status ?? 'FAIL';
  console.log('');
  console.log('=== RECOVERY DRILL ===');
  console.log(`Fuente: ${result.source}`);
  console.log(`Target temporal: ${result.targetRoot}`);
  console.log(`Limpieza temporal: ${result.cleaned ? 'SI' : 'NO'}`);
  console.log(`SQLite integrity: ${statusFor('SQLite restaurada integrity_check')}`);
  console.log(`Foreign keys: ${statusFor('SQLite restaurada foreign_key_check')}`);
  console.log(`Conteos: ${statusFor('Conteos restaurados')}`);
  console.log(`Evidencias: ${result.manifest.evidence.count}`);
  console.log(`Field integrity: ${statusFor('Integridad de campo restaurada')}`);
  console.log(`Contadores: ${JSON.stringify(result.verification.counts)}`);
  console.log('RECOVERY DRILL: PASS');
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPoint === import.meta.url) {
  try {
    const result = runRecoveryDrill({
      backupDir: argumentValue('--backup') || latestOperationalBackup(),
      keep: process.argv.includes('--keep'),
    });
    printResult(result);
  } catch (error) {
    console.error('');
    console.error('RECOVERY DRILL: FAIL');
    console.error(error.message);
    process.exitCode = 1;
  }
}
