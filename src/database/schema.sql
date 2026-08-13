PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_imports (
  id INTEGER PRIMARY KEY,
  import_code TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  source_checksum TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  location_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  inventory_import_id INTEGER,
  location_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  category_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (inventory_import_id) REFERENCES inventory_imports(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id INTEGER PRIMARY KEY,
  session_code TEXT NOT NULL UNIQUE,
  status_code TEXT NOT NULL DEFAULT 'open',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  observation_code TEXT NOT NULL UNIQUE,
  inventory_session_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  condition_code TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (inventory_session_id) REFERENCES inventory_sessions(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_code TEXT NOT NULL,
  action_code TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_location_id
  ON assets(location_id);

CREATE INDEX IF NOT EXISTS idx_observations_session_id
  ON observations(inventory_session_id);

CREATE INDEX IF NOT EXISTS idx_observations_asset_id
  ON observations(asset_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log(entity_type, entity_code);
