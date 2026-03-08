const fs = require("fs");
const path = require("path");
const readline = require("readline");

function requireFromWeb(moduleName) {
  const modulePath = path.join(__dirname, "..", "..", "web", "node_modules", moduleName);
  return require(modulePath);
}

const XLSX = requireFromWeb("xlsx");

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function detectNameHeader(headers) {
  const aliases = ["name", "paid by", "parent name", "donor name", "payer", "payor"];
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (aliases.includes(normalized) || normalized.includes("name")) {
      return header;
    }
  }
  return null;
}

function readSpreadsheetRows(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function chooseDefaultInputFiles(inputFolder) {
  return fs.readdirSync(inputFolder).filter((name) => /\.(csv|xlsx|xls)$/i.test(name));
}

function toCsv(rows) {
  if (rows.length === 0) {
    return "";
  }
  const headerSet = new Set();
  for (const row of rows) {
    Object.keys(row).forEach((key) => headerSet.add(key));
  }
  const headers = Array.from(headerSet);

  const escape = (value) => {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("File Merge");
    console.log("Input: Payment spreadsheet + payor data sheet folder");
    console.log("Output: Merged spreadsheet matched by name");
    console.log("");

    const inputFolder = await ask(rl, "Input folder path: ");
    const outputFolder = await ask(rl, "Output folder path: ");

    if (!fs.existsSync(inputFolder) || !fs.statSync(inputFolder).isDirectory()) {
      throw new Error("Input folder does not exist.");
    }
    if (!fs.existsSync(outputFolder) || !fs.statSync(outputFolder).isDirectory()) {
      throw new Error("Output folder does not exist.");
    }

    const candidates = chooseDefaultInputFiles(inputFolder);
    if (candidates.length < 2) {
      throw new Error("Input folder needs at least two spreadsheet files (.csv/.xlsx/.xls).");
    }

    console.log("Spreadsheets found:");
    candidates.forEach((file) => console.log(`- ${file}`));
    console.log("");

    const paymentFileName = await ask(rl, "Payment spreadsheet file name: ");
    const dataFileName = await ask(rl, "Data sheet file name: ");

    const paymentFilePath = path.join(inputFolder, paymentFileName);
    const dataFilePath = path.join(inputFolder, dataFileName);

    if (!fs.existsSync(paymentFilePath)) {
      throw new Error("Payment spreadsheet file was not found.");
    }
    if (!fs.existsSync(dataFilePath)) {
      throw new Error("Data sheet file was not found.");
    }

    const paymentRows = readSpreadsheetRows(paymentFilePath);
    const dataRows = readSpreadsheetRows(dataFilePath);

    if (paymentRows.length === 0) {
      throw new Error("Payment spreadsheet has no rows.");
    }
    if (dataRows.length === 0) {
      throw new Error("Data sheet has no rows.");
    }

    const paymentNameHeader = detectNameHeader(Object.keys(paymentRows[0]));
    const dataNameHeader = detectNameHeader(Object.keys(dataRows[0]));
    if (!paymentNameHeader || !dataNameHeader) {
      throw new Error("Both sheets must have a Name column.");
    }

    const dataByName = new Map();
    for (const row of dataRows) {
      const key = normalizeName(row[dataNameHeader]);
      if (key && !dataByName.has(key)) {
        dataByName.set(key, row);
      }
    }

    let matched = 0;
    const mergedRows = paymentRows.map((paymentRow) => {
      const key = normalizeName(paymentRow[paymentNameHeader]);
      const dataRow = key ? dataByName.get(key) : null;
      if (!dataRow) {
        return { ...paymentRow };
      }

      matched += 1;
      const merged = { ...paymentRow };
      for (const [column, value] of Object.entries(dataRow)) {
        if (!(column in merged) || !String(merged[column] ?? "").trim()) {
          merged[column] = value;
        }
      }
      return merged;
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(outputFolder, `merged_spreadsheet_${stamp}.csv`);
    fs.writeFileSync(outFile, toCsv(mergedRows), "utf8");

    console.log("");
    console.log(`Done. Payment rows: ${paymentRows.length}`);
    console.log(`Rows matched by name: ${matched}`);
    console.log(`Output file: ${outFile}`);
  } catch (error) {
    console.error("");
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

void main();
