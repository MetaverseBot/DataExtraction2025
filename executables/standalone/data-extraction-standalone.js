#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const pdfParse = require("pdf-parse");

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function formatAmount(amountText) {
  const normalized = String(amountText).replaceAll("$", "").replaceAll(",", "").trim();
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `$${value.toFixed(2)}`;
}

function normalizeName(nameText) {
  const value = String(nameText).replace(/\s+/g, " ").trim();
  if (!value || !/[A-Za-z]/.test(value)) {
    return null;
  }
  return value;
}

function inferYearFromFileName(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/(20\d{2})/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  if (!Number.isFinite(year) || year < 2000 || year > 2099) {
    return null;
  }
  return year;
}

function toIsoDate(mmdd, year) {
  const parts = mmdd.split("/");
  if (parts.length !== 2) {
    return null;
  }
  const mm = parts[0].padStart(2, "0");
  const dd = parts[1].padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function groupItemsIntoRows(items) {
  const byRow = new Map();
  for (const item of items) {
    const text = String(item.str ?? "").trim();
    if (!text) {
      continue;
    }
    const y = Number(item.transform?.[5] ?? 0);
    const x = Number(item.transform?.[4] ?? 0);
    const rowKey = String(Math.round(y * 2) / 2);
    if (!byRow.has(rowKey)) {
      byRow.set(rowKey, []);
    }
    byRow.get(rowKey).push({ text, x, y });
  }

  const rows = [];
  for (const rowItems of byRow.values()) {
    rowItems.sort((a, b) => a.x - b.x);
    const rowText = rowItems.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim();
    rows.push({ rowItems, rowText });
  }

  return rows;
}

function parseNameFromDescription(descriptionText) {
  const paymentFromMatch = descriptionText.match(/Payment\s+From\s+(.+)$/i);
  if (!paymentFromMatch) {
    return { ok: false, reason: "Missing payer text after Payment From" };
  }

  const trailing = paymentFromMatch[1].trim();
  if (!trailing) {
    return { ok: false, reason: "Empty payer text" };
  }

  const tokens = trailing.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, reason: "Empty payer tokens" };
  }

  let nameTokens = tokens.slice();
  const lastToken = tokens[tokens.length - 1] ?? "";
  const idLike =
    (/\d/.test(lastToken) && lastToken.length >= 6) ||
    (/^Bac[0-9A-Za-z]{6,}$/i.test(lastToken) && lastToken.length >= 9) ||
    /^0Jj[0-9A-Za-z]{6,}$/i.test(lastToken);
  if (idLike && tokens.length > 1) {
    nameTokens = tokens.slice(0, -1);
  }

  const name = normalizeName(nameTokens.join(" "));
  if (!name) {
    return { ok: false, reason: "Invalid payer name" };
  }

  return { ok: true, name };
}

function parsePaymentRowDeterministic(row, inferredYear) {
  if (!row.rowText.includes("Payment From")) {
    return null;
  }

  const dateCells = row.rowItems.filter((cell) => /^\d{2}\/\d{2}(?:\/\d{2,4})?$/.test(cell.text));
  if (dateCells.length !== 1) {
    return { ok: false, reason: "Date cell not uniquely identified", sourceLine: row.rowText };
  }
  const dateMatch = dateCells[0].text.match(/^(\d{2}\/\d{2})/);
  if (!dateMatch) {
    return { ok: false, reason: "Date format invalid", sourceLine: row.rowText };
  }
  const mmddDate = dateMatch[1];
  const paymentDate = inferredYear ? toIsoDate(mmddDate, inferredYear) ?? mmddDate : mmddDate;

  const amountCells = row.rowItems.filter(
    (cell) => cell.x >= 420 && /^\$?\d{1,4}(?:,\d{3})*\.\d{2}$/.test(cell.text),
  );
  if (amountCells.length !== 1) {
    return { ok: false, reason: "Amount cell not uniquely identified", sourceLine: row.rowText };
  }
  const amount = formatAmount(amountCells[0].text);
  if (!amount) {
    return { ok: false, reason: "Amount is not valid positive currency", sourceLine: row.rowText };
  }

  const descriptionParts = row.rowItems
    .filter((cell) => cell.x >= 70 && cell.x < 420)
    .map((cell) => cell.text);
  const descriptionText = descriptionParts.join(" ").replace(/\s+/g, " ").trim();
  if (!descriptionText.includes("Payment From")) {
    return { ok: false, reason: "Description column missing Payment From", sourceLine: row.rowText };
  }

  const parsedName = parseNameFromDescription(descriptionText);
  if (!parsedName.ok) {
    return { ok: false, reason: parsedName.reason, sourceLine: row.rowText };
  }

  return {
    ok: true,
    record: {
      name: parsedName.name,
      paymentDate,
      amount,
    },
  };
}

async function extractFromPdfFileDeterministic(filePath) {
  const buffer = fs.readFileSync(filePath);
  const rows = [];
  const inferredYear = inferYearFromFileName(filePath);

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      rows.push(...groupItemsIntoRows(textContent.items));
      return "";
    },
  });

  const records = [];
  const invalid = [];

  for (const row of rows) {
    const parsed = parsePaymentRowDeterministic(row, inferredYear);
    if (!parsed) {
      continue;
    }
    if (parsed.ok) {
      records.push(parsed.record);
    } else {
      invalid.push({ reason: parsed.reason, line: parsed.sourceLine });
    }
  }

  return { records, invalid };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("Data Extraction (Standalone EXE)");
    console.log("Input: Bank statement PDFs");
    console.log("Output: Name, Payment Date, Amount CSV");
    console.log("");

    const inputFolder = await ask(rl, "Input folder path: ");
    const outputFolder = await ask(rl, "Output folder path: ");

    if (!fs.existsSync(inputFolder) || !fs.statSync(inputFolder).isDirectory()) {
      throw new Error("Input folder does not exist.");
    }
    if (!fs.existsSync(outputFolder) || !fs.statSync(outputFolder).isDirectory()) {
      throw new Error("Output folder does not exist.");
    }

    const pdfFiles = fs
      .readdirSync(inputFolder)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .map((name) => path.join(inputFolder, name));

    if (pdfFiles.length === 0) {
      throw new Error("No PDF files found in input folder.");
    }

    const allRecords = [];
    const allInvalid = [];

    for (const pdfFile of pdfFiles) {
      console.log(`Parsing ${path.basename(pdfFile)} ...`);
      const result = await extractFromPdfFileDeterministic(pdfFile);
      allRecords.push(...result.records);
      for (const invalid of result.invalid) {
        allInvalid.push({ file: path.basename(pdfFile), reason: invalid.reason, line: invalid.line });
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outCsv = path.join(outputFolder, `payment_spreadsheet_${stamp}.csv`);
    const csvLines = ["Name,Payment Date,Amount"];
    for (const row of allRecords) {
      csvLines.push([csvEscape(row.name), csvEscape(row.paymentDate), csvEscape(row.amount)].join(","));
    }
    fs.writeFileSync(outCsv, `${csvLines.join("\r\n")}\r\n`, "utf8");

    const outInvalid = path.join(outputFolder, `invalid_payment_lines_${stamp}.csv`);
    const invalidLines = ["File,Reason,Source Line"];
    for (const row of allInvalid) {
      invalidLines.push([csvEscape(row.file), csvEscape(row.reason), csvEscape(row.line)].join(","));
    }
    fs.writeFileSync(outInvalid, `${invalidLines.join("\r\n")}\r\n`, "utf8");

    console.log("");
    console.log(`Done. Records extracted: ${allRecords.length}`);
    console.log(`Rejected lines: ${allInvalid.length}`);
    console.log(`Output CSV: ${outCsv}`);
    console.log(`Rejected-lines CSV: ${outInvalid}`);
  } catch (error) {
    console.error("");
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    console.log("");
    await ask(rl, "Press Enter to close...");
    rl.close();
  }
}

void main();
