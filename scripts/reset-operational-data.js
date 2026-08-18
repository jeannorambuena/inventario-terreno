import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

import { createDatabaseBackup } from '../src/database/backup.js';
import { getDatabasePath, openDatabase } from '../src/database/connection.js';

const confirmationPhrase = 'RESET-OPERACIONAL';
const projectRoot = resolve('.');
const evidencePath = resolve(projectRoot, 'evidence');
const backupsPath = resolve(projectRoot, 'backups');

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function tableCount(database, tableName, where = '') {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName} ${where}`).get().count;
}

function snapshot(database) {
  return {
    imports: tableCount(database, 'inventory_imports'),
    locations: tableCount(database, 'locations'),
    assets: tableCount(database, 'assets'),
    sessions: tableCount(database, 'inventory_sessions'),
    openSessions: tableCount(database, 'inventory_sessions', "WHERE status_code = 'open'"),
    observations: tableCount(database, 'observations'),
    activeObservations: tableCount(database, 'observations', 'WHERE active = 1'),
    evidenceRows: tableCount(database, 'evidence_files'),
    pairings: tableCount(database, 'session_pairings'),
    auditRows: tableCount(database, 'audit_log'),
  };
}

function printSnapshot(title, data) {
  console.log(title);
  console.log(`  Maestro: ${data.imports} importacion(es), ${data.locations} ubicacion(es), ${data.assets} bien(es).`);
  console.log(`  Operacion: ${data.sessions} sesion(es) (${data.openSessions} abierta(s)), ${data.observations} observacion(es) (${data.activeObservations} activa(s)).`);
  console.log(`  Evidencias: ${data.evidenceRows} registro(s). Emparejamientos: ${data.pairings}. Auditoria: ${data.auditRows}.`);
}

async function serverIsRunning() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch('http://127.0.0.1:3180/api/health', { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const databasePath = getDatabasePath();
if (!existsSync(databasePath)) {
  console.error(`No existe la base local: ${databasePath}`);
  process.exit(1);
}

if (await serverIsRunning()) {
  console.error('Inventario Terreno esta ejecutandose. Detengalo con "Detener Inventario Terreno.cmd" antes de continuar.');
  process.exit(3);
}

const database = openDatabase(databasePath);
try {
  const before = snapshot(database);
  printSnapshot('Estado actual:', before);

  const confirmIndex = process.argv.indexOf('--confirm');
  const suppliedConfirmation = confirmIndex >= 0 ? process.argv[confirmIndex + 1] : '';
  if (suppliedConfirmation !== confirmationPhrase) {
    console.log('\nMODO VISTA PREVIA: no se modifico ningun dato.');
    console.log('Este proceso conserva inventory_imports, locations y assets; elimina solamente sesiones y trazabilidad operacional.');
    console.log(`Para ejecutar el reinicio, repita con: --confirm ${confirmationPhrase}`);
    process.exitCode = 2;
  } else {
    mkdirSync(backupsPath, { recursive: true });
    const stamp = timestamp();
    const backupPath = resolve(backupsPath, `pre-reset-operacional-${stamp}.sqlite`);
    const createdBackup = await createDatabaseBackup({ sourcePath: databasePath, destinationPath: backupPath });
    console.log(`\nRespaldo SQLite previo creado: ${createdBackup}`);

    let archivedEvidencePath = null;
    if (existsSync(evidencePath) && readdirSync(evidencePath, { withFileTypes: true }).length > 0) {
      archivedEvidencePath = resolve(backupsPath, `evidence-pre-reset-${stamp}`);
      renameSync(evidencePath, archivedEvidencePath);
      mkdirSync(evidencePath, { recursive: true });
      console.log(`Evidencia anterior archivada en: ${archivedEvidencePath}`);
    } else {
      mkdirSync(evidencePath, { recursive: true });
    }

    database.transaction(() => {
      database.pragma('defer_foreign_keys = ON');
      database.exec(`
        DELETE FROM evidence_exceptions;
        DELETE FROM evidence_files;
        DELETE FROM observation_details;
        DELETE FROM session_ambiguities;
        DELETE FROM session_pairings;
        DELETE FROM session_provisional_sequences;
        DELETE FROM audit_log;
        UPDATE observations SET supersedes_observation_id = NULL;
        DELETE FROM observations;
        DELETE FROM open_session_locks;
        DELETE FROM inventory_sessions;
      `);
    }).immediate();

    const quickCheck = database.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok') throw new Error(`SQLite quick_check fallo despues del reinicio: ${quickCheck}`);

    const after = snapshot(database);
    printSnapshot('\nEstado despues del reinicio:', after);
    if (after.sessions || after.observations || after.evidenceRows || after.pairings || after.auditRows) {
      throw new Error('El reinicio no dejo vacias todas las tablas operacionales.');
    }
    if (after.imports !== before.imports || after.locations !== before.locations || after.assets !== before.assets) {
      throw new Error('El maestro cambio durante el reinicio; restaure inmediatamente el respaldo previo.');
    }

    console.log('\nRESET OPERACIONAL COMPLETADO.');
    console.log('El maestro (importaciones, ubicaciones y bienes) fue preservado.');
    console.log('Las sesiones, observaciones, incidencias, emparejamientos y auditoria operacional quedaron en cero.');
    if (archivedEvidencePath) console.log('Las fotografias anteriores quedaron archivadas, no eliminadas definitivamente.');
  }
} finally {
  database.close();
}
