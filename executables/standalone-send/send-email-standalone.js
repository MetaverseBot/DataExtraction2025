#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const trimmed = answer.trim();
      const unquoted = trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
      resolve(unquoted);
    });
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeFilePart(value) {
  return String(value ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
}

function formatCellValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 60000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.m}/${parsed.d}/${parsed.y}`;
    }
  }

  return String(value ?? "").trim();
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
      normalizedRow[key] = formatCellValue(value);
    }
    return normalizedRow;
  });
}

function getValueByAliases(row, aliases) {
  const entries = Object.entries(row).map(([key, value]) => ({
    key: String(key ?? "").trim().toLowerCase(),
    value: String(value ?? "").trim(),
  }));

  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase();
    const found = entries.find((entry) => entry.key === normalizedAlias);
    if (found && found.value) {
      return found.value;
    }
  }

  return "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? "").trim());
}

function parseDotEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

function getMailerConfig(envPath) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing Gmail config file at ${envPath}`);
  }

  const env = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  const user = String(env.GMAIL_USER ?? "").trim();
  const clientId = String(env.GMAIL_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.GMAIL_CLIENT_SECRET ?? "").trim();
  const refreshToken = String(env.GMAIL_REFRESH_TOKEN ?? "").trim();

  if (!user || !clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail OAuth env vars in web/.env.local. Required: GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.",
    );
  }

  return { user, clientId, clientSecret, refreshToken, envPath };
}

function buildLetterIndex(lettersFolder) {
  const files = fs
    .readdirSync(lettersFolder)
    .filter((name) => /\.(docx|pdf|doc|txt|md)$/i.test(name))
    .map((name) => ({
      name,
      path: path.join(lettersFolder, name),
      normalizedName: normalizeName(name.replace(/\.[^.]+$/, "")),
    }));

  const index = new Map();
  for (const file of files) {
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const candidateNames = new Set();

    candidateNames.add(baseName);

    const dashParts = baseName.split(" - ");
    if (dashParts.length >= 2) {
      candidateNames.add(dashParts[dashParts.length - 1]);
    }

    const letterPrefixMatch = baseName.match(/^Letter\s*-\s*(.+)$/i);
    if (letterPrefixMatch) {
      candidateNames.add(letterPrefixMatch[1]);
    }

    for (const candidate of candidateNames) {
      const normalizedCandidate = normalizeName(sanitizeFilePart(candidate).replace(/_/g, " "));
      if (!normalizedCandidate) {
        continue;
      }
      if (!index.has(normalizedCandidate)) {
        index.set(normalizedCandidate, []);
      }
      index.get(normalizedCandidate).push(file);
    }
  }

  return { files, index };
}

function getAttachmentsForDonor(letterIndex, donorName) {
  const directKey = normalizeName(donorName);
  const sanitizedKey = normalizeName(sanitizeFilePart(donorName).replace(/_/g, " "));
  const attachments = [
    ...(letterIndex.index.get(directKey) ?? []),
    ...(letterIndex.index.get(sanitizedKey) ?? []),
  ];

  const deduped = [];
  const seen = new Set();
  for (const attachment of attachments) {
    if (seen.has(attachment.path)) {
      continue;
    }
    seen.add(attachment.path);
    deduped.push(attachment);
  }
  return deduped;
}

function getIndexedDonorKeys(letterIndex) {
  return Array.from(letterIndex.index.keys()).sort((a, b) => a.localeCompare(b));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("Send Email (Standalone EXE)");
    console.log("Input: Letters folder + spreadsheet with Name and Email columns");
    console.log("Output: Sends each donor email with matching letter attachment(s)");
    console.log("");

    const envPath = await ask(rl, "web/.env.local path: ");
    const lettersFolder = await ask(rl, "Letters folder path: ");
    const spreadsheetPath = await ask(rl, "Spreadsheet path: ");

    if (!fs.existsSync(envPath) || !fs.statSync(envPath).isFile()) {
      throw new Error("web/.env.local file was not found.");
    }
    if (!fs.existsSync(lettersFolder) || !fs.statSync(lettersFolder).isDirectory()) {
      throw new Error("Letters folder does not exist.");
    }
    if (!fs.existsSync(spreadsheetPath) || !fs.statSync(spreadsheetPath).isFile()) {
      throw new Error("Spreadsheet file was not found.");
    }

    const rows = readSpreadsheetRows(spreadsheetPath);
    if (rows.length === 0) {
      throw new Error("Spreadsheet has no rows.");
    }

    const { user, clientId, clientSecret, refreshToken } = getMailerConfig(envPath);
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user,
        clientId,
        clientSecret,
        refreshToken,
      },
    });

    const letterIndex = buildLetterIndex(lettersFolder);
    if (letterIndex.files.length === 0) {
      throw new Error("No letter files found in letters folder.");
    }

    console.log(`Using Gmail config from: ${envPath}`);
    console.log(`Letter files found: ${letterIndex.files.length}`);
    console.log(`Indexed donor keys: ${getIndexedDonorKeys(letterIndex).length}`);
    console.log("");

    let sent = 0;
    const skipped = [];

    for (const row of rows) {
      const donorName = getValueByAliases(row, ["name", "donor name", "parent name", "parent/guardian name"]);
      const email = getValueByAliases(row, ["email", "email address", "e-mail"]);

      if (!donorName) {
        skipped.push({ donorName: "", email, reason: "Missing name" });
        continue;
      }
      if (!isValidEmail(email)) {
        skipped.push({ donorName, email, reason: "Missing or invalid email" });
        continue;
      }

      const attachments = getAttachmentsForDonor(letterIndex, donorName);
      if (attachments.length === 0) {
        skipped.push({ donorName, email, reason: "No matching letter files found" });
        continue;
      }

      await transporter.sendMail({
        from: user,
        to: email,
        subject: "AAPASD Letter",
        text: `Dear ${donorName},\n\nPlease find your attached letter from AAPASD.\n\nBest regards,\nAAPASD`,
        attachments: attachments.map((attachment) => ({
          filename: attachment.name,
          content: fs.readFileSync(attachment.path),
        })),
      });

      sent += 1;
      console.log(`Sent: ${donorName} -> ${email} (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})`);
    }

    const reportPath = path.join(
      lettersFolder,
      `send_email_report_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
    );
    const reportLines = ["Name,Email,Status,Reason"];
    for (const row of skipped) {
      reportLines.push(
        [row.donorName, row.email, "Skipped", row.reason]
          .map((value) => csvEscape(value))
          .join(","),
      );
    }
    fs.writeFileSync(reportPath, `${reportLines.join("\r\n")}\r\n`, "utf8");

    console.log("");
    console.log(`Done. Emails sent: ${sent}`);
    console.log(`Skipped: ${skipped.length}`);
    console.log(`Report: ${reportPath}`);
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
