const { Readable } = require("stream");
const csv = require("csv-parser");

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(csv({ mapHeaders: ({ header }) => String(header || "").replace(/^\uFEFF/, "").trim() }))
      .on("data", row => rows.push(row))
      .on("error", reject)
      .on("end", () => resolve(rows));
  });
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = { parseCsvBuffer, csvEscape };
