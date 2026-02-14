import { DonationRecord } from "@/lib/types";

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function donationsToCsv(records: DonationRecord[]): string {
  const header = ["Name", "Date", "Amount", "Payment Type", "Email"];
  const rows = records.map((record) => [
    record.name,
    record.date,
    record.amount,
    record.paymentType,
    record.email,
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");
}

function parseCsvLine(line: string): string[] {
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

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseDonationsCsv(csvText: string): DonationRecord[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const rows = lines.map((line) => parseCsvLine(line));
  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((cell) => cell.toLowerCase());

  const nameIdx = normalizedHeader.indexOf("name");
  const dateIdx = normalizedHeader.indexOf("date");
  const amountIdx = normalizedHeader.indexOf("amount");
  const paymentTypeIdx = normalizedHeader.indexOf("payment type");
  const emailIdx = normalizedHeader.indexOf("email");

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
