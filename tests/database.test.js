import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';

import { openDatabase } from '../src/database/connection.js';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database initialization', () => {
  test('creates a temporary SQLite database with the initial tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'inventario-terreno-'));
    const databasePath = join(directory, 'synthetic-test.sqlite');
    temporaryDirectories.push(directory);

    const database = openDatabase(databasePath);

    try {
      const tableNames = database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all()
        .map(({ name }) => name);

      expect(tableNames).toEqual([
        'assets',
        'audit_log',
        'evidence_exceptions',
        'evidence_files',
        'inventory_imports',
        'inventory_sessions',
        'locations',
        'observation_details',
        'observations',
        'open_session_locks',
        'session_ambiguities',
        'session_pairings',
        'session_provisional_sequences',
      ]);
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
      const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(({ name }) => name);
      expect(indexes).toEqual(expect.arrayContaining([
        'idx_observations_active_session_asset',
        'idx_observations_active_session_provisional',
      ]));
    } finally {
      database.close();
    }
  });

  test('preserves codes with leading zeroes as text', () => {
    const database = openDatabase(':memory:');

    try {
      database
        .prepare('INSERT INTO locations (location_code, name) VALUES (?, ?)')
        .run('0007', 'Ubicación sintética');

      const location = database
        .prepare('SELECT location_code, typeof(location_code) AS storage_type FROM locations')
        .get();

      expect(location).toEqual({
        location_code: '0007',
        storage_type: 'text',
      });
    } finally {
      database.close();
    }
  });

  test('stops an additive uniqueness migration without deleting incompatible historical rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'inventario-migration-synthetic-'));
    const databasePath = join(directory, 'legacy-conflict.sqlite');
    temporaryDirectories.push(directory);
    const database = openDatabase(databasePath);
    database.exec(`
      INSERT INTO inventory_imports (import_code, source_name, source_checksum) VALUES ('imp', 'synthetic.xlsx', 'hash');
      INSERT INTO locations (location_code, name) VALUES ('loc', 'Sintética');
      INSERT INTO assets (asset_code, inventory_import_id, location_id, name) VALUES ('000001', 1, 1, 'Sintético');
      INSERT INTO inventory_sessions (session_code, location_id) VALUES ('session', 1);
      DROP INDEX idx_observations_active_session_asset;
      INSERT INTO observations (observation_code, inventory_session_id, asset_id, status_code, selected_location_id, observed_at)
        VALUES ('obs-1', 1, 1, 'verificado', 1, '2026-01-01T00:00:00.000Z');
      INSERT INTO observations (observation_code, inventory_session_id, asset_id, status_code, selected_location_id, observed_at)
        VALUES ('obs-2', 1, 1, 'verificado', 1, '2026-01-01T00:01:00.000Z');
    `);
    database.close();

    expect(() => openDatabase(databasePath)).toThrow(/UNIQUE constraint failed/);
    const preserved = new Database(databasePath, { readonly: true });
    expect(preserved.prepare('SELECT COUNT(*) AS count FROM observations').get().count).toBe(2);
    expect(preserved.pragma('integrity_check', { simple: true })).toBe('ok');
    preserved.close();
  });
});
