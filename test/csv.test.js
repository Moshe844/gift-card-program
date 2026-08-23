const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsvBuffer } = require("../utils/csv");

test("CSV parser recognizes common spreadsheet header names", async () => {
  const rows = await parseCsvBuffer(
    Buffer.from("Phone Number,Gift Card Number,Funding Amount\n3476756700',1234567890123456,25.00\n"),
    { expectedHeaders: ["phone", "cardnum", "amount"] }
  );

  assert.deepEqual(rows[0], { phone: "3476756700'", cardnum: "1234567890123456", amount: "25.00" });
  assert.deepEqual(rows.meta.headers, ["phone", "cardnum", "amount"]);
});

test("CSV parser supports semicolon-delimited headerless rows in expected order", async () => {
  const rows = await parseCsvBuffer(
    Buffer.from("3476756700;1234567890123456;$1,250.00\n"),
    { expectedHeaders: ["phone", "cardnum", "amount"] }
  );

  assert.equal(rows.meta.headerless, true);
  assert.equal(rows.meta.separator, ";");
  assert.deepEqual(rows[0], { phone: "3476756700", cardnum: "1234567890123456", amount: "$1,250.00" });
});

test("CSV parser supports Excel UTF-16 tab-delimited files", async () => {
  const text = "Phone\tCardNum\tAmount\r\n3476756700\t1234567890123456\t40\r\n";
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const rows = await parseCsvBuffer(buffer, { expectedHeaders: ["phone", "cardnum", "amount"] });

  assert.equal(rows.meta.separator, "tab");
  assert.deepEqual(rows[0], { phone: "3476756700", cardnum: "1234567890123456", amount: "40" });
});

test("CSV parser reports unrecognized headers instead of creating empty values", async () => {
  const rows = await parseCsvBuffer(
    Buffer.from("Customer,Code,Credit\n3476756700,1234567890123456,25\n"),
    { expectedHeaders: ["phone", "cardnum", "amount"] }
  );

  assert.deepEqual(rows.meta.headers, ["customer", "code", "credit"]);
  assert.equal(rows[0].phone, undefined);
});
