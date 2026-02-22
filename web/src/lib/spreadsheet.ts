import { DonationRecord } from "@/lib/types";
import * as XLSX from "xlsx";

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function donationsToCsv(
  records: DonationRecord[],
  defaultYear?: number,
  includeEmail = true,
): string {
  const header = includeEmail
    ? ["Name", "Date", "Amount", "Payment Type", "Email"]
    : ["Name", "Date", "Amount", "Payment Type"];
  const rows = records.map((record) => [
    record.name,
    normalizeDateForCsv(record.date, defaultYear),
    record.amount,
    record.paymentType,
    ...(includeEmail ? [record.email] : []),
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");
}

function normalizeDateForCsv(dateValue: string, defaultYear?: number): string {
  if (/20\d{2}/.test(dateValue)) {
    return dateValue;
  }

  if (!defaultYear || !/^\d{2}\/\d{2}$/.test(dateValue.trim())) {
    return dateValue;
  }

  return `${dateValue}/${defaultYear}`;
}

type CsvDelimiter = "," | "\t" | ";";

function splitNonEmptyLines(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseCsvLine(line: string, delimiter: CsvDelimiter): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function detectDelimiter(headerLine: string): CsvDelimiter {
  const delimiterCounts: Array<{ delimiter: CsvDelimiter; count: number }> = [
    { delimiter: ",", count: (headerLine.match(/,/g) ?? []).length },
    { delimiter: "\t", count: (headerLine.match(/\t/g) ?? []).length },
    { delimiter: ";", count: (headerLine.match(/;/g) ?? []).length },
  ];

  delimiterCounts.sort((a, b) => b.count - a.count);
  return delimiterCounts[0]?.count > 0 ? delimiterCounts[0].delimiter : ",";
}

function normalizeHeaderCell(cell: string): string {
  return cell
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ");
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function findHeaderIndex(header: string[], aliases: string[]): number {
  for (let i = 0; i < header.length; i += 1) {
    const cell = header[i];
    for (const alias of aliases) {
      if (cell === alias || cell.startsWith(alias) || alias.startsWith(cell)) {
        return i;
      }
    }
  }

  for (const alias of aliases) {
    const idx = header.indexOf(alias);
    if (idx !== -1) {
      return idx;
    }
  }
  return -1;
}

export function parseDonationsCsv(csvText: string): DonationRecord[] {
  const lines = splitNonEmptyLines(csvText);

  if (lines.length === 0) {
    return [];
  }

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);

  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((cell) => normalizeHeaderCell(cell));

  const nameIdx = findHeaderIndex(normalizedHeader, [
    "name",
    "donor",
    "donor name",
    "sponsor",
    "sponsors",
    "sponsor(s)",
  ]);
  const dateIdx = findHeaderIndex(normalizedHeader, ["date", "contribution date"]);
  const amountIdx = findHeaderIndex(normalizedHeader, ["amount", "total amount"]);
  const paymentTypeIdx = findHeaderIndex(normalizedHeader, [
    "payment type",
    "payment t",
    "payment",
    "payment method",
    "type",
  ]);
  const emailIdx = findHeaderIndex(normalizedHeader, ["email", "e mail", "email address"]);

  if (nameIdx === -1 || dateIdx === -1 || amountIdx === -1 || paymentTypeIdx === -1) {
    throw new Error(
      "Spreadsheet columns must include: Name, Date, Amount, Payment Type, Email.",
    );
  }

  return dataRows
    .map((row) => ({
      name: row[nameIdx] ?? "",
      date: row[dateIdx] ?? "",
      amount: row[amountIdx] ?? "",
      paymentType: row[paymentTypeIdx] ?? "",
      email: emailIdx >= 0 ? (row[emailIdx] ?? "N/A") : "N/A",
    }))
    .filter((row) => row.name && row.date && row.amount);
}

export function parseCsvRowsGeneric(csvText: string): Record<string, string>[] {
  const lines = splitNonEmptyLines(csvText);

  if (lines.length === 0) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  const [headerRaw, ...dataRows] = rows;
  const headers = headerRaw.map((cell) => cell.replace(/^\uFEFF/, "").trim());

  return dataRows
    .map((row) => {
      const mapped: Record<string, string> = {};
      headers.forEach((header, index) => {
        if (header) {
          mapped[header] = (row[index] ?? "").trim();
        }
      });
      return mapped;
    })
    .filter((row) => Object.values(row).some((value) => value.length > 0));
}

export async function parseDonorDatabaseFile(
  file: File,
): Promise<Map<string, string>> {
  const fileName = file.name.toLowerCase();
  const textTypes = [".csv", ".tsv", ".txt"];
  if (textTypes.some((ext) => fileName.endsWith(ext))) {
    const text = await file.text();
    return parseDonorDatabaseCsv(text);
  }

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) {
      return new Map();
    }

    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });

    return rowsToDonorEmailMap(
      rows.map((row) => row.map((cell) => String(cell ?? "").trim())),
    );
  }

  throw new Error("Unsupported donor database file type. Use CSV or Excel.");
}

function parseDonorDatabaseCsv(csvText: string): Map<string, string> {
  const lines = splitNonEmptyLines(csvText);

  if (lines.length === 0) {
    return new Map();
  }

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);

  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  return rowsToDonorEmailMap(rows);
}

function rowsToDonorEmailMap(rows: string[][]): Map<string, string> {
  if (rows.length === 0) {
    return new Map();
  }

  const [headerRaw, ...dataRows] = rows;
  const header = headerRaw.map((cell) => normalizeHeaderCell(cell));

  const firstNameIdx = findHeaderIndex(header, ["first name", "frist name", "first"]);
  const lastNameIdx = findHeaderIndex(header, ["last name", "last"]);
  const nameIdx = findHeaderIndex(header, ["name", "full name", "donor", "donor name"]);
  const emailIdx = findHeaderIndex(header, ["email", "email address", "e mail"]);

  if (emailIdx === -1) {
    throw new Error("Donor database must contain an Email column.");
  }

  const result = new Map<string, string>();

  for (const row of dataRows) {
    const email = (row[emailIdx] ?? "").trim();
    if (!isValidEmail(email)) {
      continue;
    }

    let fullName = "";
    if (nameIdx !== -1) {
      fullName = (row[nameIdx] ?? "").trim();
    } else if (firstNameIdx !== -1 || lastNameIdx !== -1) {
      const first = firstNameIdx !== -1 ? (row[firstNameIdx] ?? "").trim() : "";
      const last = lastNameIdx !== -1 ? (row[lastNameIdx] ?? "").trim() : "";
      fullName = `${first} ${last}`.trim();
    }

    if (!fullName) {
      continue;
    }

    result.set(normalizeName(fullName), email);
  }

  return result;
}

export function applyDonorEmails(
  records: DonationRecord[],
  donorEmailMap: Map<string, string>,
): DonationRecord[] {
  return records.map((record) => {
    const mappedEmail = donorEmailMap.get(normalizeName(record.name));
    if (!mappedEmail) {
      return record;
    }

    return {
      ...record,
      email: mappedEmail,
    };
  });
}

export type CampPaymentRow = {
  paymentDate: string;
  amount: string;
  paidBy: string;
  email: string;
  camperName: string;
  campDates: string;
};

export type CampDirectoryRow = {
  parentName: string;
  camperName: string;
  campDates: string;
  email: string;
};

export function donationsToCampPayments(records: DonationRecord[]): CampPaymentRow[] {
  return records.map((record) => ({
    paymentDate: record.date,
    amount: record.amount,
    paidBy: record.name,
    email: record.email || "N/A",
    camperName: "",
    campDates: "",
  }));
}

export function campPaymentsToCsv(rows: CampPaymentRow[], defaultYear?: number): string {
  const header = [
    "Payment Date",
    "Amount",
    "Paid By",
    "Email",
    "Camper Name",
    "Camp Dates",
  ];
  const body = rows.map((row) => [
    normalizeDateForCsv(row.paymentDate, defaultYear),
    row.amount,
    row.paidBy,
    row.email,
    row.camperName,
    row.campDates,
  ]);

  return [header, ...body]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");
}

export function parseCampPaymentsCsv(text: string): CampPaymentRow[] {
  const lines = splitNonEmptyLines(text);

  if (lines.length === 0) {
    return [];
  }

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  const rows = lines.map((line) => parseCsvLine(line, delimiter));

  const [headerRaw, ...dataRows] = rows;
  const header = headerRaw.map((cell) => normalizeHeaderCell(cell));

  const paymentDateIdx = findHeaderIndex(header, ["payment date", "date"]);
  const amountIdx = findHeaderIndex(header, ["amount"]);
  const paidByIdx = findHeaderIndex(header, ["paid by", "name", "parent", "parent name"]);
  const emailIdx = findHeaderIndex(header, ["email", "email address"]);
  const camperNameIdx = findHeaderIndex(header, ["camper name", "camper"]);
  const campDatesIdx = findHeaderIndex(header, ["camp dates", "camp date"]);

  if (paymentDateIdx === -1 || amountIdx === -1 || paidByIdx === -1) {
    throw new Error("Payment spreadsheet must include Payment Date, Amount, and Paid By columns.");
  }

  return dataRows
    .map((row) => ({
      paymentDate: (row[paymentDateIdx] ?? "").trim(),
      amount: (row[amountIdx] ?? "").trim(),
      paidBy: (row[paidByIdx] ?? "").trim(),
      email: emailIdx !== -1 ? (row[emailIdx] ?? "N/A").trim() || "N/A" : "N/A",
      camperName: camperNameIdx !== -1 ? (row[camperNameIdx] ?? "").trim() : "",
      campDates: campDatesIdx !== -1 ? (row[campDatesIdx] ?? "").trim() : "",
    }))
    .filter((row) => row.paymentDate && row.amount && row.paidBy);
}

export async function parseCampDirectoryFile(file: File): Promise<CampDirectoryRow[]> {
  const fileName = file.name.toLowerCase();
  const textTypes = [".csv", ".tsv", ".txt"];
  if (textTypes.some((ext) => fileName.endsWith(ext))) {
    const text = await file.text();
    return parseCampDirectoryCsv(text);
  }

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) {
      return [];
    }

    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });

    return rowsToCampDirectoryRows(
      rows.map((row) => row.map((cell) => String(cell ?? "").trim())),
    );
  }

  throw new Error("Unsupported camp data file type. Use CSV or Excel.");
}

function parseCampDirectoryCsv(text: string): CampDirectoryRow[] {
  const lines = splitNonEmptyLines(text);

  if (lines.length === 0) {
    return [];
  }

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  return rowsToCampDirectoryRows(rows);
}

function rowsToCampDirectoryRows(rows: string[][]): CampDirectoryRow[] {
  if (rows.length === 0) {
    return [];
  }

  const [headerRaw, ...dataRows] = rows;
  const header = headerRaw.map((cell) => normalizeHeaderCell(cell));

  const parentIdx = findHeaderIndex(header, ["parent name", "paid by", "parent", "name"]);
  const camperIdx = findHeaderIndex(header, ["camper name", "camper"]);
  const campDatesIdx = findHeaderIndex(header, ["camp dates", "camp date"]);
  const emailIdx = findHeaderIndex(header, ["email", "email address"]);

  if (parentIdx === -1 || camperIdx === -1 || campDatesIdx === -1 || emailIdx === -1) {
    throw new Error("Camp data must include Parent Name, Camper Name, Camp Dates, and Email.");
  }

  return dataRows
    .map((row) => ({
      parentName: (row[parentIdx] ?? "").trim(),
      camperName: (row[camperIdx] ?? "").trim(),
      campDates: (row[campDatesIdx] ?? "").trim(),
      email: (row[emailIdx] ?? "").trim(),
    }))
    .filter((row) => row.parentName && row.camperName && row.campDates);
}

export function mergeCampData(
  payments: CampPaymentRow[],
  campDirectory: CampDirectoryRow[],
): CampPaymentRow[] {
  const byParent = new Map<string, CampDirectoryRow>();
  for (const row of campDirectory) {
    byParent.set(normalizeName(row.parentName), row);
  }

  return payments.map((payment) => {
    const match = byParent.get(normalizeName(payment.paidBy));
    if (!match) {
      return payment;
    }

    return {
      ...payment,
      camperName: match.camperName,
      campDates: match.campDates,
      email: isValidEmail(match.email) ? match.email : payment.email,
    };
  });
}
