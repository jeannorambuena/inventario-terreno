import ExcelJS from 'exceljs';

const CODE_HEADER_NAMES = new Set([
  'asset_code',
  'codigo',
  'codigo_bien',
  'codigo_del_bien',
  'codigo_escaner',
  'codigo_del_escaner',
  'scanner_code',
]);

function createResult() {
  return {
    headers: [],
    rowCount: 0,
    records: [],
    warnings: [],
    errors: [],
  };
}

export function normalizeHeader(header) {
  return String(header ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cellToText(cell) {
  const { value } = cell;

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    const zeroFormat = typeof cell.numFmt === 'string' && /^0+$/.test(cell.numFmt)
      ? cell.numFmt
      : undefined;

    if (zeroFormat && Number.isSafeInteger(value)) {
      return String(value).padStart(zeroFormat.length, '0');
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object' && 'result' in value) {
    return String(value.result ?? '').trim();
  }

  return String(cell.text ?? '').trim();
}

function readHeaders(worksheet, result) {
  const headerRow = worksheet.getRow(1);
  const usedNames = new Map();

  for (let columnNumber = 1; columnNumber <= headerRow.cellCount; columnNumber += 1) {
    const original = cellToText(headerRow.getCell(columnNumber));
    const baseName = normalizeHeader(original) || `column_${columnNumber}`;
    const occurrences = (usedNames.get(baseName) ?? 0) + 1;
    const normalized = occurrences === 1 ? baseName : `${baseName}_${occurrences}`;

    usedNames.set(baseName, occurrences);
    result.headers.push({ original, normalized, columnNumber });

    if (!original) {
      result.warnings.push({
        code: 'EMPTY_HEADER',
        columnNumber,
        message: `La columna ${columnNumber} no tiene encabezado.`,
      });
    } else if (occurrences > 1) {
      result.warnings.push({
        code: 'DUPLICATE_HEADER',
        columnNumber,
        message: `El encabezado normalizado "${baseName}" está repetido.`,
      });
    }
  }
}

function getRequestedWorksheet(workbook, sheetName) {
  if (sheetName === undefined) {
    return workbook.worksheets[0];
  }

  return workbook.getWorksheet(sheetName);
}

export async function importExcel(filePath, options = {}) {
  const result = createResult();
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(filePath);
  } catch (error) {
    result.errors.push({
      code: 'FILE_READ_ERROR',
      message: 'No fue posible leer el archivo XLSX.',
    });
    return result;
  }

  const worksheet = getRequestedWorksheet(workbook, options.sheetName);

  if (!worksheet) {
    result.errors.push({
      code: options.sheetName === undefined ? 'EMPTY_WORKBOOK' : 'SHEET_NOT_FOUND',
      message: options.sheetName === undefined
        ? 'El archivo XLSX no contiene hojas.'
        : `No existe la hoja "${options.sheetName}".`,
    });
    return result;
  }

  if (worksheet.actualRowCount === 0 || worksheet.getRow(1).cellCount === 0) {
    result.errors.push({
      code: 'EMPTY_SHEET',
      message: 'La hoja seleccionada está vacía.',
    });
    return result;
  }

  readHeaders(worksheet, result);

  const codeHeader = result.headers.find(({ normalized }) => CODE_HEADER_NAMES.has(normalized));

  if (!codeHeader) {
    result.errors.push({
      code: 'CODE_COLUMN_NOT_FOUND',
      message: 'Debe existir una columna de código del bien o código escáner.',
    });
  }

  const seenCodes = new Map();

  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record = Object.fromEntries(
      result.headers.map(({ normalized, columnNumber }) => [
        normalized,
        cellToText(row.getCell(columnNumber)),
      ]),
    );

    if (Object.values(record).every((value) => value === '')) {
      continue;
    }

    result.records.push(record);

    if (!codeHeader) {
      continue;
    }

    const code = record[codeHeader.normalized];

    if (!code) {
      result.warnings.push({
        code: 'EMPTY_CODE',
        rowNumber,
        message: `La fila ${rowNumber} no tiene código.`,
      });
      continue;
    }

    if (seenCodes.has(code)) {
      result.warnings.push({
        code: 'DUPLICATE_CODE',
        rowNumber,
        firstRowNumber: seenCodes.get(code),
        value: code,
        message: `El código "${code}" está duplicado.`,
      });
    } else {
      seenCodes.set(code, rowNumber);
    }
  }

  result.rowCount = result.records.length;
  return result;
}
