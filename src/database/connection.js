import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
const defaultDatabasePath = resolve(projectRoot, 'data', 'inventario.sqlite');

export function getDatabasePath() {
  const configuredPath = process.env.INVENTARIO_DB_PATH?.trim();
  return configuredPath || defaultDatabasePath;
}

export function openDatabase(databasePath = getDatabasePath()) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new Database(databasePath);

  try {
    database.pragma('foreign_keys = ON');
    database.exec(readFileSync(schemaPath, 'utf8'));
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
