import { resolve } from 'node:path';

import Database from 'better-sqlite3';

import { verifyFieldIntegrity } from '../src/field-integrity.js';

const databasePath = resolve(process.env.INVENTARIO_DB_PATH || 'data/inventario.sqlite');
const evidenceRoot = resolve(process.env.INVENTARIO_EVIDENCE_ROOT || 'evidence');

let database;

try {
  database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });

  const report = verifyFieldIntegrity(database, {
    evidenceRoot,
    verifyHashes: true,
  });

  console.log('');
  console.log('=== VERIFICACION DE INTEGRIDAD OPERACIONAL ===');
  console.log(`Base: ${databasePath}`);
  console.log(`Evidencia: ${evidenceRoot}`);
  console.log('');

  for (const check of report.checks) {
    console.log(`[${check.status}] ${check.name} - ${check.detail}`);

    if (check.status !== 'PASS' && check.data) {
      console.log(JSON.stringify(check.data, null, 2));
    }
  }

  console.log('');
  console.log(
    `Observaciones activas: ${report.totals.observations} | `
    + `Evidencias activas: ${report.totals.activeEvidence} | `
    + `Excepciones: ${report.totals.evidenceExceptions}`,
  );

  console.log('');
  console.log(`INTEGRIDAD OPERACIONAL: ${report.status}`);

  if (report.warnings > 0) {
    console.log(`Advertencias: ${report.warnings}`);
  }

  if (report.failures > 0) {
    console.log(`Fallos: ${report.failures}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('');
  console.error('INTEGRIDAD OPERACIONAL: FAIL');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  database?.close();
}
