import { DonationRecord } from "@/lib/types";

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function donationsToCsv(
  records: DonationRecord[],
  defaultYear?: number,
): string {
  const header = ["Name", "Date", "Amount", "Payment Type", "Email"];
  const rows = records.map((record) => [
    record.name,
    normalizeDateForCsv(record.date, defaultYear),
    record.amount,
    record.paymentType,
    record.email,
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

function parseCsvLine(line: string, delimiter: "," | "\t"): string[] {
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

function normalizeHeaderCell(cell: string): string {
  return cell
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ");
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
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headerLine = lines[0];
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const delimiter: "," | "\t" = tabCount > commaCount ? "\t" : ",";

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
