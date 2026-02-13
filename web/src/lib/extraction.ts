import { donorDirectory, donorNames } from "@/lib/donorDirectory";
import { DonationRecord } from "@/lib/types";

const MAX_REASONABLE_DONATION = 1000;

function inferNameFromDirectory(text: string): string | null {
  const matchedName = donorNames.find((name) => text.includes(name));
  return matchedName ?? null;
}

function formatAmount(amount: string): string {
  const normalized = amount.replaceAll(",", "").replace("$", "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return amount.startsWith("$") ? amount : `$${amount}`;
  }
  return `$${value.toFixed(2)}`;
}

function chooseReasonableDollars(intPart: string): number | null {
  let bestCandidate: number | null = null;

  for (let suffixLen = 1; suffixLen <= Math.min(4, intPart.length); suffixLen += 1) {
    const dollars = Number(intPart.slice(-suffixLen));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      continue;
    }

    if (dollars <= MAX_REASONABLE_DONATION) {
      if (bestCandidate === null || dollars > bestCandidate) {
        bestCandidate = dollars;
      }
    }
  }

  return bestCandidate;
}

function normalizeEmail(name: string): string {
  const email = donorDirectory.get(name);
  if (!email) {
    return "N/A";
  }

  if (email.toLowerCase().endsWith("@example.com")) {
    return "N/A";
  }

  return email;
}

function parseAmount(line: string): string | null {
  const currencyMatch = line.match(/\$([\d,]+\.\d{2})$/);
  if (currencyMatch) {
    const [dollarsRaw, cents] = currencyMatch[1].split(".");
    const intPart = dollarsRaw.replaceAll(",", "");
    const numeric = Number(intPart);

    if (Number.isFinite(numeric) && numeric <= MAX_REASONABLE_DONATION) {
      return formatAmount(currencyMatch[1]);
    }

    const fixed = chooseReasonableDollars(intPart);
    if (fixed !== null) {
      return formatAmount(`${fixed}.${cents}`);
    }

    return formatAmount(currencyMatch[1]);
  }

  const finalNumber = line.match(/(\d+)\.(\d{2})$/);
  if (!finalNumber) {
    return null;
  }

  const intPart = finalNumber[1];
  const cents = finalNumber[2];

  if (intPart.length <= 4) {
    const numeric = Number(intPart);
    if (Number.isFinite(numeric) && numeric <= MAX_REASONABLE_DONATION) {
      return formatAmount(`${intPart}.${cents}`);
    }

    const fixed = chooseReasonableDollars(intPart);
    if (fixed !== null) {
      return formatAmount(`${fixed}.${cents}`);
    }

    return formatAmount(`${intPart}.${cents}`);
  }

  const bestCandidate = chooseReasonableDollars(intPart);

  if (bestCandidate !== null) {
    return formatAmount(`${bestCandidate}.${cents}`);
  }

  return formatAmount(`${intPart.slice(-3)}.${cents}`);
}

function parseName(lineRemainder: string): string | null {
  const knownName = inferNameFromDirectory(lineRemainder);
  if (knownName) {
    return knownName;
  }

  const fallbackMatch = lineRemainder.match(/^([A-Za-z]+(?:\s+[A-Za-z]+){0,3})\b/);
  return fallbackMatch ? fallbackMatch[1].trim() : null;
}

function parsePaymentLine(line: string): DonationRecord | null {
  const dateMatch = line.match(/^(\d{2}\/\d{2})/);
  const paymentTypeMatch = line.match(
    /^\d{2}\/\d{2}\s*([A-Za-z ]+?)\s+Payment\s+From\b/i,
  );
  const fromIndex = line.indexOf("Payment From");

  if (!dateMatch || !paymentTypeMatch || fromIndex === -1) {
    return null;
  }

  const date = dateMatch[1];
  const paymentType = paymentTypeMatch[1].trim();
  const lineRemainder = line.slice(fromIndex + "Payment From".length).trim();
  const name = parseName(lineRemainder);
  const amount = parseAmount(line);

  if (!name || !amount) {
    return null;
  }

  return {
    name,
    date,
    amount,
    paymentType,
    email: normalizeEmail(name),
  };
}

export function extractDonationsFromText(text: string): {
  records: DonationRecord[];
  invalidLines: number;
} {
  const paymentLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("Payment From"));

  const records: DonationRecord[] = [];
  let invalidLines = 0;

  for (const line of paymentLines) {
    const record = parsePaymentLine(line);
    if (record) {
      records.push(record);
    } else {
      invalidLines += 1;
    }
  }

  return { records, invalidLines };
}
