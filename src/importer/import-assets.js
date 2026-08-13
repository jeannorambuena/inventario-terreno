import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

import { importExcel } from './excel-importer.js';

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function text(record, key) {
  return String(record[key] ?? '').trim();
}

function locationCode(direction, department, section) {
  return createHash('sha256')
    .update(JSON.stringify([direction, department, section]))
    .digest('hex');
}

export async function importAssetsFromExcel({ database, filePath, sheetName = 'BD_SQL' }) {
  const checksumBefore = await sha256(filePath);
  const parsed = await importExcel(filePath, { sheetName });

  if (parsed.errors.length > 0) {
    throw new Error(`Importación rechazada: ${parsed.errors.map(({ code }) => code).join(', ')}`);
  }

  const requiredHeaders = [
    'codigo_bien', 'bien', 'marca', 'serie', 'modelo', 'color',
    'direccion', 'departamento', 'seccion', 'finbaja', 'codigo_escaner',
  ];
  const availableHeaders = new Set(parsed.headers.map(({ normalized }) => normalized));
  const missingHeaders = requiredHeaders.filter((header) => !availableHeaders.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Faltan columnas requeridas: ${missingHeaders.join(', ')}`);
  }

  const checksumAfterRead = await sha256(filePath);
  if (checksumAfterRead !== checksumBefore) {
    throw new Error('La fuente XLSX cambió durante la lectura.');
  }

  const performImport = database.transaction(() => {
    const importResult = database.prepare(`
      INSERT INTO inventory_imports (
        import_code, source_name, source_checksum, sheet_name, row_count
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(import_code) DO UPDATE SET
        source_name = excluded.source_name,
        source_checksum = excluded.source_checksum,
        sheet_name = excluded.sheet_name,
        row_count = excluded.row_count
      RETURNING id
    `).get(checksumBefore, basename(filePath), checksumBefore, sheetName, parsed.rowCount);

    const upsertLocation = database.prepare(`
      INSERT INTO locations (
        location_code, name, direction, department, section
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(location_code) DO UPDATE SET
        name = excluded.name,
        direction = excluded.direction,
        department = excluded.department,
        section = excluded.section
      RETURNING id
    `);

    const upsertAsset = database.prepare(`
      INSERT INTO assets (
        asset_code, inventory_import_id, location_id, name, brand,
        serial_number, model, color, finbaja, scanner_code, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(asset_code) DO UPDATE SET
        inventory_import_id = excluded.inventory_import_id,
        location_id = excluded.location_id,
        name = excluded.name,
        brand = excluded.brand,
        serial_number = excluded.serial_number,
        model = excluded.model,
        color = excluded.color,
        finbaja = excluded.finbaja,
        scanner_code = excluded.scanner_code,
        updated_at = excluded.updated_at
    `);

    let importedRows = 0;
    for (const record of parsed.records) {
      const assetCode = text(record, 'codigo_bien');
      if (!assetCode) continue;

      const direction = text(record, 'direccion');
      const department = text(record, 'departamento');
      const section = text(record, 'seccion');
      const locationName = [direction, department, section].filter(Boolean).join(' / ') || 'Sin ubicación';
      const location = upsertLocation.get(
        locationCode(direction, department, section),
        locationName,
        direction,
        department,
        section,
      );

      upsertAsset.run(
        assetCode,
        importResult.id,
        location.id,
        text(record, 'bien'),
        text(record, 'marca'),
        text(record, 'serie'),
        text(record, 'modelo'),
        text(record, 'color'),
        text(record, 'finbaja'),
        text(record, 'codigo_escaner'),
      );
      importedRows += 1;
    }

    return { importId: importResult.id, importedRows };
  });

  const imported = performImport();

  return {
    ...imported,
    sourceChecksum: checksumBefore,
    sourceRowCount: parsed.rowCount,
    warningCount: parsed.warnings.length,
  };
}
