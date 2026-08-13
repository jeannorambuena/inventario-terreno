import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { afterEach, describe, expect, test } from 'vitest';

import { importExcel } from '../src/importer/excel-importer.js';
import { importAssetsFromExcel } from '../src/importer/import-assets.js';
import { openDatabase } from '../src/database/connection.js';

const temporaryDirectories = [];

async function writeSyntheticWorkbook(configureWorkbook) {
  const directory = mkdtempSync(join(tmpdir(), 'inventario-importer-'));
  const filePath = join(directory, 'synthetic-inventory.xlsx');
  const workbook = new ExcelJS.Workbook();

  temporaryDirectories.push(directory);
  configureWorkbook(workbook);
  await workbook.xlsx.writeFile(filePath);

  return filePath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Excel importer', () => {
  test('reads an indicated sheet and preserves synthetic codes exactly', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      workbook.addWorksheet('Resumen').addRow(['Sin datos']);
      const worksheet = workbook.addWorksheet('Inventario sintético');
      worksheet.addRow(['Código del bien', 'Descripción Original']);
      worksheet.addRow(['0010600073', 'Elemento sintético A']);
      worksheet.addRow(['0000000123', 'Elemento sintético B']);
    });

    const result = await importExcel(filePath, { sheetName: 'Inventario sintético' });

    expect(result.errors).toEqual([]);
    expect(result.rowCount).toBe(2);
    expect(result.headers).toEqual([
      {
        original: 'Código del bien',
        normalized: 'codigo_del_bien',
        columnNumber: 1,
      },
      {
        original: 'Descripción Original',
        normalized: 'descripcion_original',
        columnNumber: 2,
      },
    ]);
    expect(result.records.map(({ codigo_del_bien: code }) => code)).toEqual([
      '0010600073',
      '0000000123',
    ]);
  });

  test('reports an empty first sheet', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      workbook.addWorksheet('Vacía');
    });

    const result = await importExcel(filePath);

    expect(result).toMatchObject({
      headers: [],
      rowCount: 0,
      records: [],
      warnings: [],
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'EMPTY_SHEET' }),
    ]);
  });

  test('reports a requested sheet that does not exist', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      workbook.addWorksheet('Disponible').addRow(['Código escáner']);
    });

    const result = await importExcel(filePath, { sheetName: 'Inexistente' });

    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'SHEET_NOT_FOUND' }),
    ]);
    expect(result.rowCount).toBe(0);
  });

  test('warns when a synthetic code is duplicated', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      const worksheet = workbook.addWorksheet('Inventario');
      worksheet.addRow(['Código escáner', 'Estado']);
      worksheet.addRow(['0000000123', 'Sintético']);
      worksheet.addRow(['0000000123', 'Sintético repetido']);
    });

    const result = await importExcel(filePath);

    expect(result.errors).toEqual([]);
    expect(result.rowCount).toBe(2);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_CODE',
        value: '0000000123',
        firstRowNumber: 2,
        rowNumber: 3,
      }),
    );
  });

  test('requires an asset or scanner code column', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      const worksheet = workbook.addWorksheet('Inventario');
      worksheet.addRow(['Descripción', 'Estado']);
      worksheet.addRow(['Elemento sintético', 'Disponible']);
    });

    const result = await importExcel(filePath);

    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'CODE_COLUMN_NOT_FOUND' }),
    ]);
    expect(result.rowCount).toBe(1);
  });

  test('ignores empty styled headers after the last header with content', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      const worksheet = workbook.addWorksheet('Inventario');
      worksheet.addRow(['Código del bien', 'Bien']);
      worksheet.addRow(['0000000001', 'Elemento sintético']);
      worksheet.getRow(1).getCell(25).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' },
      };
    });

    const result = await importExcel(filePath);

    expect(result.headers).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  test('stores a protected synthetic import in SQLite as text', async () => {
    const filePath = await writeSyntheticWorkbook((workbook) => {
      const worksheet = workbook.addWorksheet('BD_SQL');
      worksheet.addRow([
        'CODIGO_BIEN', 'BIEN', 'MARCA', 'SERIE', 'MODELO', 'COLOR',
        'DIRECCION', 'DEPARTAMENTO', 'SECCION', 'FINBAJA', 'CODIGO ESCANER',
      ]);
      worksheet.addRow([
        '0010600073', 'Elemento sintético', 'Marca sintética', 'SERIE-01',
        'Modelo sintético', 'Verde', 'Dirección sintética',
        'Departamento sintético', 'Sección sintética', '0', '0000000123',
      ]);
    });
    const database = openDatabase(':memory:');

    try {
      const result = await importAssetsFromExcel({ database, filePath, sheetName: 'BD_SQL' });
      const stored = database.prepare(`
        SELECT asset_code AS assetCode, scanner_code AS scannerCode,
          typeof(asset_code) AS assetType, typeof(scanner_code) AS scannerType
        FROM assets
      `).get();

      expect(result).toMatchObject({ importedRows: 1, sourceRowCount: 1 });
      expect(result.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
      expect(stored).toEqual({
        assetCode: '0010600073',
        scannerCode: '0000000123',
        assetType: 'text',
        scannerType: 'text',
      });
    } finally {
      database.close();
    }
  });
});
