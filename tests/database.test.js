import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

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
        'inventory_imports',
        'inventory_sessions',
        'locations',
        'observations',
        'session_pairings',
      ]);
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
});
