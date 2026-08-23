const { Readable } = require("stream");
const csv = require("csv-parser");
const readExcelFile = require("read-excel-file/node").default;
const MAX_UPLOAD_ROWS = 5000;

class SpreadsheetImportError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "SpreadsheetImportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const HEADER_ALIASES = new Map([
  ["phone", "phone"],
  ["phonenumber", "phone"],
  ["telephone", "phone"],
  ["telephonenumber", "phone"],
  ["mobile", "phone"],
  ["mobilenumber", "phone"],
  ["cardnum", "cardnum"],
  ["cardnumber", "cardnum"],
  ["giftcard", "cardnum"],
  ["giftcardnum", "cardnum"],
  ["giftcardnumber", "cardnum"],
  ["amount", "amount"],
  ["value", "amount"],
  ["giftamount", "amount"],
  ["funds", "amount"],
  ["fundingamount", "amount"]
]);

function canonicalHeader(header) {
  const cleaned = String(header || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return HEADER_ALIASES.get(cleaned) || cleaned;
}

function decodeCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer || "");
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function countOutsideQuotes(line, separator) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === separator) count += 1;
  }
  return count;
}

function detectSeparator(line) {
  return [",", "\t", ";", "|"]
    .map(separator => ({ separator, count: countOutsideQuotes(line, separator) }))
    .sort((left, right) => right.count - left.count)[0].separator;
}

function splitCsvLine(line, separator) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && character === separator) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function looksLikeData(values, expectedHeaders) {
  if (!expectedHeaders.length || values.length < expectedHeaders.length) return false;
  return expectedHeaders.every((header, index) => {
    const value = String(values[index] || "").trim().replace(/^'+|'+$/g, "");
    if (header === "phone") {
      const digits = value.replace(/\D/g, "");
      return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
    }
    if (header === "cardnum") return /^\d{12,19}$/.test(value.replace(/[\s-]/g, ""));
    if (header === "amount") {
      const amount = Number(value.replace(/[$,\s]/g, ""));
      return Number.isFinite(amount) && amount > 0;
    }
    return value.length > 0;
  });
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function rowsFromMatrix(matrix, expectedHeaders, { sheet = null } = {}) {
  const nonEmptyRows = (matrix || []).filter(row =>
    Array.isArray(row) && row.some(value => cellText(value) !== "")
  );
  const canonicalExpected = expectedHeaders.map(canonicalHeader);
  const firstValues = nonEmptyRows[0] || [];
  const canonicalFirst = firstValues.map(value => canonicalHeader(cellText(value)));
  const hasRecognizedHeader = canonicalFirst.some(header => canonicalExpected.includes(header));
  const headerless = !hasRecognizedHeader && looksLikeData(firstValues.map(cellText), canonicalExpected);
  const headers = headerless ? canonicalExpected : canonicalFirst;
  const dataRows = headerless ? nonEmptyRows : nonEmptyRows.slice(1);
  const rows = dataRows.map((values, rowIndex) => {
    const row = {};
    headers.forEach((header, columnIndex) => {
      const value = values[columnIndex];
      if (header === "cardnum" && typeof value === "number" && Math.abs(value) >= 1e15) {
        const spreadsheetRow = rowIndex + (headerless ? 1 : 2);
        throw new SpreadsheetImportError(
          "XLSX_CARD_NUMBER_NOT_TEXT",
          `Gift card number on spreadsheet row ${spreadsheetRow} is stored as an Excel number and may already be rounded. Format the card-number column as Text, paste the original full numbers again, save, and re-upload.`
        );
      }
      if (header) row[header] = cellText(value);
    });
    return row;
  });

  Object.defineProperty(rows, "meta", {
    value: { separator: "xlsx", headerless, headers, sheet },
    enumerable: false
  });
  return rows;
}

function isXlsxUpload(buffer, filename, mimetype) {
  const name = String(filename || "").toLowerCase();
  const type = String(mimetype || "").toLowerCase();
  const zipSignature = Buffer.isBuffer(buffer) && buffer[0] === 0x50 && buffer[1] === 0x4b;
  return name.endsWith(".xlsx") || type.includes("spreadsheetml") || zipSignature;
}

async function parseSpreadsheetBuffer(buffer, {
  expectedHeaders = [],
  filename = "",
  mimetype = "",
  readExcelFileImpl = readExcelFile
} = {}) {
  if (!isXlsxUpload(buffer, filename, mimetype)) {
    const rows = await parseCsvBuffer(buffer, { expectedHeaders });
    if (rows.length > MAX_UPLOAD_ROWS) {
      throw new SpreadsheetImportError("SPREADSHEET_TOO_MANY_ROWS", `Uploads are limited to ${MAX_UPLOAD_ROWS} data rows.`);
    }
    return rows;
  }

  try {
    const sheets = await readExcelFileImpl(buffer);
    let fallbackRows = null;
    let safetyError = null;

    for (const candidate of sheets) {
      const hasData = Array.isArray(candidate.data) && candidate.data.some(row => row.some(value => cellText(value) !== ""));
      if (!hasData) continue;
      try {
        const rows = rowsFromMatrix(candidate.data, expectedHeaders, { sheet: candidate.sheet || null });
        if (!fallbackRows) fallbackRows = rows;
        const hasRequiredColumns = expectedHeaders.every(header => rows.meta.headers.includes(canonicalHeader(header)));
        if (hasRequiredColumns) {
          if (rows.length > MAX_UPLOAD_ROWS) {
            throw new SpreadsheetImportError("SPREADSHEET_TOO_MANY_ROWS", `Uploads are limited to ${MAX_UPLOAD_ROWS} data rows.`);
          }
          return rows;
        }
      } catch (error) {
        if (error instanceof SpreadsheetImportError) safetyError ||= error;
        else throw error;
      }
    }

    if (safetyError) throw safetyError;
    const rows = fallbackRows || rowsFromMatrix([], expectedHeaders);
    if (rows.length > MAX_UPLOAD_ROWS) {
      throw new SpreadsheetImportError("SPREADSHEET_TOO_MANY_ROWS", `Uploads are limited to ${MAX_UPLOAD_ROWS} data rows.`);
    }
    return rows;
  } catch (error) {
    if (error instanceof SpreadsheetImportError) throw error;
    throw new SpreadsheetImportError(
      "XLSX_INVALID_FILE",
      "The Excel workbook could not be read. Upload a valid .xlsx file and place the data on the first non-empty sheet."
    );
  }
}

function parseCsvBuffer(buffer, { expectedHeaders = [] } = {}) {
  return new Promise((resolve, reject) => {
    let text = decodeCsvBuffer(buffer).replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();

    const separatorDeclaration = lines[0]?.match(/^sep=(.)\s*$/i);
    const declaredSeparator = separatorDeclaration?.[1] || null;
    if (separatorDeclaration) lines.shift();

    text = lines.join("\n");
    const firstLine = lines.find(line => line.trim()) || "";
    const separator = declaredSeparator || detectSeparator(firstLine);
    const firstValues = splitCsvLine(firstLine, separator);
    const canonicalExpected = expectedHeaders.map(canonicalHeader);
    const canonicalFirst = firstValues.map(canonicalHeader);
    const hasRecognizedHeader = canonicalFirst.some(header => canonicalExpected.includes(header));
    const headerless = !hasRecognizedHeader && looksLikeData(firstValues, canonicalExpected);
    const rows = [];
    const options = {
      separator,
      mapHeaders: ({ header }) => canonicalHeader(header),
      mapValues: ({ value }) => String(value ?? "").trim(),
      ...(headerless ? { headers: canonicalExpected } : {})
    };

    Readable.from([text])
      .pipe(csv(options))
      .on("data", row => rows.push(row))
      .on("error", reject)
      .on("end", () => {
        Object.defineProperty(rows, "meta", {
          value: {
            separator: separator === "\t" ? "tab" : separator,
            headerless,
            headers: headerless ? canonicalExpected : canonicalFirst
          },
          enumerable: false
        });
        resolve(rows);
      });
  });
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = {
  SpreadsheetImportError,
  MAX_UPLOAD_ROWS,
  canonicalHeader,
  rowsFromMatrix,
  parseCsvBuffer,
  parseSpreadsheetBuffer,
  csvEscape
};
