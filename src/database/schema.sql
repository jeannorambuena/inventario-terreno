PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_imports (
  id INTEGER PRIMARY KEY,
  import_code TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  sheet_name TEXT NOT NULL DEFAULT 'BD_SQL',
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  location_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  direction TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  inventory_import_id INTEGER NOT NULL,
  location_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  category_code TEXT,
  brand TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  finbaja TEXT NOT NULL DEFAULT '',
  scanner_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (inventory_import_id) REFERENCES inventory_imports(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id INTEGER PRIMARY KEY,
  session_code TEXT NOT NULL UNIQUE,
  location_id INTEGER,
  status_code TEXT NOT NULL DEFAULT 'open',
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS observations (
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
