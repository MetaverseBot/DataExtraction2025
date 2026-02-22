import { donorDirectory, donorNames } from "@/lib/donorDirectory";
import { DonationRecord } from "@/lib/types";


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

function parseTail(lineRemainder: string):
  | { nameSegment: string; transactionId: string; amount: string }
  | null {
  const amountPattern = /^\$?\d{1,4}(?:,\d{3})*\.\d{2}$/;

  const columns = lineRemainder
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (columns.length >= 2) {
    const amountColumnIndex = columns.findIndex(
      (part, index) => index > 0 && amountPattern.test(part),
    );

    if (amountColumnIndex > 0) {
      const descriptor = columns.slice(0, amountColumnIndex).join(" ").trim();
      const amount = columns[amountColumnIndex];

      const spacedId = descriptor.match(/^(.+?)\s+([A-Za-z0-9]{6,})$/);
      if (spacedId) {
        return {
          nameSegment: spacedId[1],
          transactionId: spacedId[2],
          amount,
        };
      }

      const mergedId = descriptor.match(/^(.+?)([A-Za-z0-9]{6,})$/);
      if (mergedId) {
        return {
          nameSegment: mergedId[1],
          transactionId: mergedId[2],
          amount,
        };
      }

      return {
        nameSegment: descriptor,
        transactionId: "",
        amount,
      };
    }
  }

  const mergedNumericToken = lineRemainder.match(
    /^(.+?)\s+(\d{9,18}\.\d{2})(?:\s+.*)?$/,
  );
  if (mergedNumericToken) {
    const descriptor = mergedNumericToken[1].trim();
    const token = mergedNumericToken[2];
    const [integerPart, decimalPart] = token.split(".");

    const candidates: Array<{ transactionId: string; amount: string; score: number }> = [];
    const idLengthPriority = [11, 10, 12, 9, 13, 14, 8];

    for (let amountDigits = 1; amountDigits <= 4; amountDigits += 1) {
      if (integerPart.length - amountDigits < 8) {
        continue;
      }

      const transactionId = integerPart.slice(0, -amountDigits);
      const amountInteger = integerPart.slice(-amountDigits);
      const amount = `${amountInteger}.${decimalPart}`;
      const amountValue = Number(amount);
      if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > 10000) {
        continue;
      }

      const idLen = transactionId.length;
      const idRank = idLengthPriority.indexOf(idLen);
      const amountRank = amountDigits === 1 ? 3 : amountDigits === 2 ? 2 : amountDigits === 3 ? 1 : 0;
      const score = (idRank === -1 ? -100 : 100 - idRank * 10) + amountRank;
      candidates.push({ transactionId, amount, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best) {
      return {
        nameSegment: descriptor,
        transactionId: best.transactionId,
        amount: best.amount,
      };
    }
  }

  const strictSplit = lineRemainder.match(
    /^(.+?)\s+([A-Za-z0-9]{6,})\s+(\$?\d{1,4}(?:,\d{3})*\.\d{2})(?:\s+.*)?$/,
  );
  if (strictSplit) {
    return {
      nameSegment: strictSplit[1],
      transactionId: strictSplit[2],
      amount: strictSplit[3],
    };
  }

  const mergedAlphaId = lineRemainder.match(
    /^(.+?)\s+([A-Za-z0-9]*[A-Za-z][A-Za-z0-9]{5,})(?:\$)?([1-9]\d{0,3}\.\d{2})(?:\s+.*)?$/,
  );
  if (mergedAlphaId) {
    return {
      nameSegment: mergedAlphaId[1],
      transactionId: mergedAlphaId[2],
      amount: mergedAlphaId[3],
    };
  }

  const mergedNumericId = lineRemainder.match(
    /^(.+?)\s+(\d{8,14})(?:\$)?(\d{1,4}\.\d{2})(?:\s+.*)?$/,
  );
  if (mergedNumericId) {
    return {
      nameSegment: mergedNumericId[1],
      transactionId: mergedNumericId[2],
      amount: mergedNumericId[3],
    };
  }

  return null;
}

function parseName(nameSegment: string): string | null {
  const normalized = nameSegment
    .replace(/\s+/g, " ")
    .trim();

  const knownName = inferNameFromDirectory(normalized);
  if (knownName) {
    return knownName;
  }

  const fallbackMatch = normalized.match(/^([A-Za-z]+(?:\s+[A-Za-z]+){0,3})\b/);
  return fallbackMatch ? fallbackMatch[1].trim() : null;
}

function parsePaymentLine(line: string, sourceFileName?: string): DonationRecord | null {
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

  const tail = parseTail(lineRemainder);
  if (!tail) {
    return null;
  }

  const name = parseName(tail.nameSegment);
  const amount = formatAmount(tail.amount);
  const amountValue = Number(amount.replaceAll("$", "").replaceAll(",", ""));

  if (!name || !amount || !Number.isFinite(amountValue) || amountValue <= 0) {
    return null;
  }

  return {
    name,
    date,
    amount,
    paymentType,
    email: normalizeEmail(name),
    sourceFileName,
  };
}

export function extractDonationsFromText(
  text: string,
  sourceFileName?: string,
): {
  records: DonationRecord[];
  invalidLines: number;
  invalidExamples: string[];
} {
  const paymentLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("Payment From"));

  const records: DonationRecord[] = [];
  let invalidLines = 0;
  const invalidExamples: string[] = [];

  for (const line of paymentLines) {
    const record = parsePaymentLine(line, sourceFileName);
    if (record) {
      records.push(record);
    } else {
      invalidLines += 1;
      if (invalidExamples.length < 10) {
        invalidExamples.push(line);
      }
    }
  }

  return { records, invalidLines, invalidExamples };
}
