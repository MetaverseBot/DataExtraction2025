import JSZip from "jszip";
import { DonationRecord } from "@/lib/types";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSplitTokenRegex(token: string): RegExp {
  const parts = Array.from(token).map((char) => escapeRegex(char));
  return new RegExp(parts.join("(?:<[^>]+>)*"), "g");
}

function normalizeDate(date: string, year?: number): string {
  const trimmed = date.trim();
  if (/20\d{2}/.test(trimmed)) {
    return trimmed;
  }
  if (year && /^\d{2}\/\d{2}$/.test(trimmed)) {
    return `${trimmed}/${year}`;
  }
  return trimmed;
}

function todayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeToken(token: string): string {
  return token
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/[\u00A0\s]+/g, " ");
}

export function getDocxLetterFileName(name: string): string {
  const safe = name.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return `Thank_You_Letter_${safe}.docx`;
}

export function buildDonorTemplateReplacements(
  donorName: string,
  donations: DonationRecord[],
  year?: number,
  requestedTokens: string[] = [],
): Record<string, string> {
  const today = todayLong();
  const total = donations.reduce((sum, row) => {
    const value = Number(row.amount.replaceAll("$", "").replaceAll(",", ""));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  const first = donations[0];
  const firstDate = first ? normalizeDate(first.date, year) : "";
  const firstAmount = first?.amount ?? "$0.00";
  const firstPaymentType = first?.paymentType ?? "";

  const base: Record<string, string> = {
    Date: today,
    "Today's Date": today,
    "Today’s Date": today,
    "Todays Date": today,
    "Today Date": today,
    "Parent/Guardian Name": donorName,
    "Parent Name": donorName,
    "Donor Name": donorName,
    Name: donorName,
    "Paid Date": firstDate,
    "Contribution Date": firstDate,
    Amount: firstAmount,
    "Payment Type": firstPaymentType,
    "Total Amount": `$${total.toFixed(2)}`,
    "Donation Count": String(donations.length),
    $$: `$${total.toFixed(2)}`,
  };

  const normalizedBaseEntries = Object.entries(base).map(([key, value]) => ({
    normalized: normalizeToken(key),
    value,
  }));

  for (const token of requestedTokens) {
    if (token in base) {
      continue;
    }

    const normalized = normalizeToken(token);
    if (normalized.includes("today") && normalized.includes("date")) {
      base[token] = today;
      continue;
    }

    const matchedBase = normalizedBaseEntries.find((entry) => entry.normalized === normalized);
    if (matchedBase) {
      base[token] = matchedBase.value;
    }
  }

  return base;
}

export async function renderDocxTemplate(
  templateBuffer: ArrayBuffer,
  replacements: Record<string, string>,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const xmlPaths = Object.keys(zip.files).filter(
    (path) => path.startsWith("word/") && path.endsWith(".xml"),
  );

  for (const xmlPath of xmlPaths) {
    const xml = await zip.file(xmlPath)?.async("string");
    if (!xml) {
      continue;
    }

    let updated = xml;
    for (const [key, rawValue] of Object.entries(replacements)) {
      const token = `[${key}]`;
      const value = escapeXml(rawValue ?? "");
      updated = updated.split(token).join(value);

      const splitTokenPattern = buildSplitTokenRegex(token);
      updated = updated.replace(splitTokenPattern, value);
    }

    zip.file(xmlPath, updated);
  }

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
