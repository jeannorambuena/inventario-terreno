import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getDatabasePath, openDatabase } from './connection.js';

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function createDatabaseBackup({
  sourcePath = getDatabasePath(),
  destinationPath = resolve('backups', `inventario-${timestamp()}.sqlite`),
} = {}) {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const database = openDatabase(sourcePath);
  try {
    await database.backup(destinationPath);
  } finally {
    database.close();
  }
  return destinationPath;
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (entryPoint === import.meta.url) {
  const destinationPath = await createDatabaseBackup();
  console.log(`Respaldo local creado: ${destinationPath}`);
}
