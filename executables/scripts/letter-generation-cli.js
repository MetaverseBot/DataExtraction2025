const fs = require("fs");
const path = require("path");
const readline = require("readline");

function requireFromWeb(moduleName) {
  const modulePath = path.join(__dirname, "..", "..", "web", "node_modules", moduleName);
  return require(modulePath);
}

const XLSX = requireFromWeb("xlsx");
const JSZip = requireFromWeb("jszip");

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const trimmed = answer.trim();
      const unquoted = trimmed
        .replace(/^"(.*)"$/, "$1")
        .replace(/^'(.*)'$/, "$1")
        .trim();
      resolve(unquoted);
    });
  });
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/[\u00A0\s]+/g, " ");
}

function formatDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1);
    const day = String(value.getDate());
    const year = String(value.getFullYear());
    return `${month}/${day}/${year}`;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 60000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.m}/${parsed.d}/${parsed.y}`;
    }
  }

  return String(value ?? "").trim();
}

function todayLong() {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSplitTokenRegex(token) {
  const parts = Array.from(token).map((char) => escapeRegex(char));
  return new RegExp(parts.join("(?:<[^>]+>)*"), "g");
}

function sanitizeFilePart(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
}

function getBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function readSpreadsheetRows(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: true, cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  return rows.map((row) => {
    const normalizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key] = formatDateValue(value);
    }
    return normalizedRow;
  });
}

function detectNameColumn(headers) {
  const aliases = [
    "name",
    "donor name",
    "parent name",
    "parent/guardian name",
    "paid by",
    "payor name",
    "payer name",
  ];
  for (const header of headers) {
    const normalized = normalizeToken(header);
    if (aliases.includes(normalized) || normalized.includes("name")) {
      return header;
    }
  }
  return headers[0] || null;
}

function buildReplacementMap(row) {
  const map = new Map();
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeToken(key);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, String(value ?? ""));
    }
  }

  const today = todayLong();
  map.set("todays date", today);
  map.set("today date", today);

  return map;
}

function buildReplacementEntries(row) {
  const entries = [];
  const seen = new Set();

  const addEntry = (token, value) => {
    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) {
      return;
    }
    const key = `${normalizedToken}::${String(value ?? "")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({ token: normalizedToken, value: String(value ?? "") });
  };

  for (const [key, value] of Object.entries(row)) {
    addEntry(key, value);
  }

  const today = todayLong();
  addEntry("Today's Date", today);
  addEntry("Today’s Date", today);
  addEntry("Todays Date", today);
  addEntry("Today Date", today);

  const amountValue = Object.entries(row).find(([key]) => normalizeToken(key) === "amount")?.[1];
  if (amountValue) {
    addEntry("Amount", amountValue);
  }

  const paymentDateValue = Object.entries(row).find(([key]) => normalizeToken(key) === "payment date")?.[1];
  if (paymentDateValue) {
    addEntry("Payment Date", paymentDateValue);
    addEntry("Contribution Date", paymentDateValue);
    addEntry("Paid Date", paymentDateValue);
  }

  const nameValue = Object.entries(row).find(([key]) => normalizeToken(key).includes("name"))?.[1];
  if (nameValue) {
    addEntry("Name", nameValue);
    addEntry("Donor Name", nameValue);
    addEntry("Parent Name", nameValue);
    addEntry("Parent/Guardian Name", nameValue);
  }

  return entries;
}

function replaceBracketTokensInText(templateText, replacementMap) {
  return templateText.replace(/\[([^\]]+)\]/g, (fullMatch, tokenInner) => {
    const normalized = normalizeToken(tokenInner);
    if (!normalized || !replacementMap.has(normalized)) {
      return fullMatch;
    }
    return replacementMap.get(normalized);
  });
}

async function renderDocxTemplate(templateBuffer, replacementMap, replacementEntries) {
  const zip = await JSZip.loadAsync(templateBuffer);
  const xmlPaths = Object.keys(zip.files).filter(
    (xmlPath) => xmlPath.startsWith("word/") && xmlPath.endsWith(".xml"),
  );

  const tokens = new Map();
  for (const [normalizedKey, value] of replacementMap.entries()) {
    tokens.set(normalizedKey, escapeXml(value));
  }

  for (const xmlPath of xmlPaths) {
    const xml = await zip.file(xmlPath)?.async("string");
    if (!xml) {
      continue;
    }

    let updated = xml.replace(/\[([^\]]+)\]/g, (fullMatch, tokenInner) => {
      const normalized = normalizeToken(tokenInner);
      if (!normalized || !tokens.has(normalized)) {
        return fullMatch;
      }
      return tokens.get(normalized);
    });

    for (const entry of replacementEntries) {
      const token = `[${entry.token}]`;
      const value = escapeXml(entry.value);
      updated = updated.split(token).join(value);
      updated = updated.replace(buildSplitTokenRegex(token), value);
    }

    zip.file(xmlPath, updated);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("Letter Generation");
    console.log("Input: Template file path + CSV files folder path");
    console.log("Output: One generated letter per row");
    console.log("");

    const templatePath = await ask(rl, "Template file path (.txt/.md/.docx): ");
    const csvFolder = await ask(rl, "CSV files folder path: ");
    const outputFolder = await ask(rl, "Output folder path: ");

    if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isFile()) {
      throw new Error("Template file was not found.");
    }
    if (!fs.existsSync(csvFolder) || !fs.statSync(csvFolder).isDirectory()) {
      throw new Error("CSV files folder does not exist.");
    }
    if (!fs.existsSync(outputFolder) || !fs.statSync(outputFolder).isDirectory()) {
      throw new Error("Output folder does not exist.");
    }

    const spreadsheetCandidates = fs
      .readdirSync(csvFolder)
      .filter((name) => /\.(csv|xlsx|xls)$/i.test(name));

    if (spreadsheetCandidates.length === 0) {
      throw new Error("No spreadsheet files found in CSV files folder.");
    }

    console.log("Spreadsheet files:");
    spreadsheetCandidates.forEach((name) => console.log(`- ${name}`));
    console.log("");

    const templateExt = path.extname(templatePath).toLowerCase();

    if (![".txt", ".md", ".docx"].includes(templateExt)) {
      throw new Error("Template must be .txt, .md, or .docx");
    }

    let totalLetters = 0;

    if (templateExt === ".docx") {
      const templateBuffer = fs.readFileSync(templatePath);
      for (const spreadsheetFileName of spreadsheetCandidates) {
        const spreadsheetPath = path.join(csvFolder, spreadsheetFileName);
        const rows = readSpreadsheetRows(spreadsheetPath);
        if (rows.length === 0) {
          continue;
        }

        const headers = Object.keys(rows[0]);
        const nameColumn = detectNameColumn(headers);
        const spreadsheetBase = sanitizeFilePart(getBaseName(spreadsheetFileName));

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const replacementMap = buildReplacementMap(row);
          const replacementEntries = buildReplacementEntries(row);
          const donorName = sanitizeFilePart(row[nameColumn] || `Row_${index + 1}`) || `Row_${index + 1}`;
          const outputName = `Letter - ${spreadsheetBase} - ${donorName}.docx`;
          const outputPath = path.join(outputFolder, outputName);
          const renderedBuffer = await renderDocxTemplate(
            templateBuffer,
            replacementMap,
            replacementEntries,
          );
          fs.writeFileSync(outputPath, renderedBuffer);
          totalLetters += 1;
        }
      }
    } else {
      const templateText = fs.readFileSync(templatePath, "utf8");
      for (const spreadsheetFileName of spreadsheetCandidates) {
        const spreadsheetPath = path.join(csvFolder, spreadsheetFileName);
        const rows = readSpreadsheetRows(spreadsheetPath);
        if (rows.length === 0) {
          continue;
        }

        const headers = Object.keys(rows[0]);
        const nameColumn = detectNameColumn(headers);
        const spreadsheetBase = sanitizeFilePart(getBaseName(spreadsheetFileName));

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const replacementMap = buildReplacementMap(row);
          const donorName = sanitizeFilePart(row[nameColumn] || `Row_${index + 1}`) || `Row_${index + 1}`;
          const outputName = `Letter - ${spreadsheetBase} - ${donorName}${templateExt}`;
          const outputPath = path.join(outputFolder, outputName);
          const renderedText = replaceBracketTokensInText(templateText, replacementMap);
          fs.writeFileSync(outputPath, renderedText, "utf8");
          totalLetters += 1;
        }
      }
    }

    console.log("");
    console.log(`Done. Letters generated: ${totalLetters}`);
    console.log(`Output folder: ${outputFolder}`);
  } catch (error) {
    console.error("");
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

void main();
