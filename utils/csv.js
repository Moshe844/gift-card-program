const { Readable } = require("stream");
const csv = require("csv-parser");

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

module.exports = { canonicalHeader, parseCsvBuffer, csvEscape };
