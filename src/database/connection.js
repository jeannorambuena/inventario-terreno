import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
const defaultDatabasePath = resolve(projectRoot, 'data', 'inventario.sqlite');

function getColumns(database, tableName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all();
}

function ensureColumn(database, tableName, columnName, definition) {
  if (!getColumns(database, tableName).some(({ name }) => name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function migrateLegacySchema(database) {
  ensureColumn(database, 'inventory_imports', 'sheet_name', "TEXT NOT NULL DEFAULT 'BD_SQL'");
  ensureColumn(database, 'inventory_imports', 'row_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'locations', 'direction', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'locations', 'department', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'locations', 'section', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'assets', 'brand', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'assets', 'serial_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'assets', 'model', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'assets', 'color', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'assets', 'finbaja', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'assets', 'scanner_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'inventory_sessions', 'location_id', 'INTEGER REFERENCES locations(id)');
  ensureColumn(database, 'inventory_sessions', 'cancelled_at', 'TEXT');
  ensureColumn(database, 'inventory_sessions', 'cancellation_reason', 'TEXT');

  const observationColumns = getColumns(database, 'observations');
  const legacyAssetColumn = observationColumns.find(({ name }) => name === 'asset_id');

  if (legacyAssetColumn?.notnull === 1 || !observationColumns.some(({ name }) => name === 'status_code')) {
    database.pragma('foreign_keys = OFF');
    database.transaction(() => {
      database.exec(`
        ALTER TABLE observations RENAME TO observations_legacy;

        CREATE TABLE observations (
          id INTEGER PRIMARY KEY,
          observation_code TEXT NOT NULL UNIQUE,
          inventory_session_id INTEGER NOT NULL,
          asset_id INTEGER,
          provisional_code TEXT,
          status_code TEXT NOT NULL,
          selected_location_id INTEGER,
          notes TEXT NOT NULL DEFAULT '',
          observed_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          CHECK (asset_id IS NOT NULL OR length(trim(provisional_code)) > 0),
          CHECK (status_code IN ('verificado', 'otra_ubicacion', 'no_ubicado', 'desconocido', 'dato_distinto')),
          FOREIGN KEY (inventory_session_id) REFERENCES inventory_sessions(id),
          FOREIGN KEY (asset_id) REFERENCES assets(id),
          FOREIGN KEY (selected_location_id) REFERENCES locations(id)
        );

        INSERT INTO observations (
          id, observation_code, inventory_session_id, asset_id,
          status_code, notes, observed_at, created_at
        )
        SELECT
          id, observation_code, inventory_session_id, asset_id,
          CASE condition_code
            WHEN 'verificado' THEN 'verificado'
            WHEN 'otra_ubicacion' THEN 'otra_ubicacion'
            WHEN 'no_ubicado' THEN 'no_ubicado'
            WHEN 'dato_distinto' THEN 'dato_distinto'
            ELSE 'desconocido'
          END,
          COALESCE(notes, ''), created_at, created_at
        FROM observations_legacy;

        DROP TABLE observations_legacy;
      `);
    })();
    database.pragma('foreign_keys = ON');
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_hierarchy
      ON locations(direction, department, section);
    CREATE INDEX IF NOT EXISTS idx_assets_scanner_code
      ON assets(scanner_code);
    CREATE INDEX IF NOT EXISTS idx_observations_session_id
      ON observations(inventory_session_id);
    CREATE INDEX IF NOT EXISTS idx_observations_asset_id
      ON observations(asset_id);
  `);

  database.exec(`
    DELETE FROM open_session_locks
    WHERE inventory_session_id IN (
      SELECT id FROM inventory_sessions WHERE status_code <> 'open'
    );

    INSERT OR IGNORE INTO open_session_locks (location_id, inventory_session_id)
    SELECT location_id, MIN(id)
    FROM inventory_sessions
    WHERE status_code = 'open' AND location_id IS NOT NULL
    GROUP BY location_id
    HAVING COUNT(*) = 1;
  `);
}

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
    migrateLegacySchema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
