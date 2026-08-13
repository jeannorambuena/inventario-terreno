import { resolve } from 'node:path';

import { openDatabase } from '../database/connection.js';
import { importAssetsFromExcel } from './import-assets.js';

const database = openDatabase();

try {
  const result = await importAssetsFromExcel({
    database,
    filePath: resolve('imports', 'ACTIVOS.xlsx'),
    sheetName: 'BD_SQL',
  });
  console.log(JSON.stringify({
    importedRows: result.importedRows,
    sourceRowCount: result.sourceRowCount,
    warningCount: result.warningCount,
  }));
} finally {
  database.close();
}
