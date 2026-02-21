"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Download } from "lucide-react";
import Link from "next/link";
import {
  downloadThankYouLetter,
  downloadThankYouLetterWord,
  getCampReceiptLetterBlob,
  getThankYouLetterBlob,
  getThankYouLetterFileName,
  getThankYouLetterWordBlob,
  getThankYouLetterWordFileName,
} from "@/lib/letterPdf";
import {
  buildDonorTemplateReplacements,
  getDocxLetterFileName,
  renderDocxTemplate,
} from "@/lib/docxTemplate";
import {
  applyDonorEmails,
  mergeCampData,
  donationsToCsv,
  parseCsvRowsGeneric,
  parseCampDirectoryFile,
  parseCampPaymentsCsv,
  type CampPaymentRow,
  parseDonationsCsv,
  parseDonorDatabaseFile,
} from "@/lib/spreadsheet";
import { DonationRecord } from "@/lib/types";

type BatchSummary = {
  _id: string;
  createdAt: number;
  totalRecords: number;
  fileNames: string[];
};

type BatchDetail = {
  batch: BatchSummary;
  donations: DonationRecord[];
};

type DonationsViewMode = "individual" | "totals";
type SortDirection = "asc" | "desc";
type LetterFormat = "pdf" | "word";

type IndividualSortKey = "name" | "date" | "amount" | "paymentType" | "email";
type TotalSortKey = "name" | "totalAmount" | "donationCount" | "email";

type DonorTotalRow = {
  name: string;
  email: string;
  donationCount: number;
  totalAmount: number;
};

function inferStatementYear(fileNames: string[]): number | undefined {
  for (const fileName of fileNames) {
    const yearMatch = fileName.match(/(20\d{2})/);
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      if (Number.isFinite(year) && year >= 2000 && year <= 2099) {
        return year;
      }
    }
  }

  return undefined;
}

function amountToNumber(amount: string): number {
  const normalized = amount.replaceAll("$", "").replaceAll(",", "").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function parseYearOverride(yearText: string): number | undefined {
  if (yearText.trim().length !== 4) {
    return undefined;
  }

  const value = Number(yearText);
  if (!Number.isFinite(value) || value < 2000 || value > 2099) {
    return undefined;
  }

  return value;
}

function isValidDonorEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function extractTemplateParameters(templateText: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const bracketRegex = /\[([^\]]+)\]/g;
  let match = bracketRegex.exec(templateText);
  while (match) {
    const token = match[1].trim();
    if (token && !seen.has(token)) {
      seen.add(token);
      found.push(token);
    }
    match = bracketRegex.exec(templateText);
  }

  if (templateText.includes("$$") && !seen.has("$$")) {
    found.push("$$");
  }

  return found;
}

function normalizeTemplateKey(value: string): string {
  return value
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/[\u00A0\s]+/g, " ");
}

function isTodaysDateToken(value: string): boolean {
  const normalized = normalizeTemplateKey(value);
  return normalized.includes("today") && normalized.includes("date");
}

function buildTemplateReplacementsFromRow(
  row: Record<string, string>,
  fallbackName: string,
  donations: DonationRecord[],
  year: number | undefined,
  templateParameters: string[],
): Record<string, string> {
  const replacements = buildDonorTemplateReplacements(
    fallbackName,
    donations,
    year,
    templateParameters,
  );

  const normalizedEntries = Object.entries(row).map(([key, value]) => ({
    key,
    norm: normalizeTemplateKey(key),
    value,
  }));

  for (const { key, value } of normalizedEntries) {
    if (isTodaysDateToken(key)) {
      continue;
    }
    replacements[key] = value;
  }

  for (const token of templateParameters) {
    if (isTodaysDateToken(token)) {
      continue;
    }
    const tokenNorm = normalizeTemplateKey(token);
    const found = normalizedEntries.find((entry) => entry.norm === tokenNorm);
    if (found) {
      replacements[token] = found.value;
    }
  }

  return replacements;
}

async function readDocTemplateText(file: File, label: string): Promise<string> {
  const lower = file.name.toLowerCase();
  const isText = lower.endsWith(".txt") || lower.endsWith(".md");
  const isDocx = lower.endsWith(".docx");
  const allowed = isText || isDocx;
  if (!allowed) {
    throw new Error(`${label} must be a .txt, .md, or .docx file.`);
  }

  let text = "";
  if (isDocx) {
    const mammoth = await import("mammoth/mammoth.browser");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = value;
  } else {
    text = await file.text();
  }

  if (!text.trim()) {
    throw new Error(`${label} is empty.`);
  }

  if (text.includes("[Content_Types].xml") || text.startsWith("PK")) {
    throw new Error(`${label} looks like a binary Office file. Please upload plain text or .docx.`);
  }

  return text;
}

async function readCampTemplateText(file: File): Promise<string> {
  return readDocTemplateText(file, "Camp template");
}

async function readDonorTemplateText(file: File): Promise<string> {
  return readDocTemplateText(file, "Letter template");
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [activeBatch, setActiveBatch] = useState<BatchDetail | null>(null);
  const [invalidLines, setInvalidLines] = useState<number>(0);
  const [invalidExamples, setInvalidExamples] = useState<string[]>([]);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [campPayments, setCampPayments] = useState<CampPaymentRow[]>([]);
  const [campPaymentSheetFile, setCampPaymentSheetFile] = useState<File | null>(null);
  const [campDataFile, setCampDataFile] = useState<File | null>(null);
  const [campTemplateFile, setCampTemplateFile] = useState<File | null>(null);
  const [campSendEmailConfirm, setCampSendEmailConfirm] = useState(true);
  const [isGeneratingCampLetters, setIsGeneratingCampLetters] = useState(false);
  const [currentPanel, setCurrentPanel] = useState(0);
  const [showLanding, setShowLanding] = useState(true);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [step2Spreadsheet, setStep2Spreadsheet] = useState<File | null>(null);
  const [step2UploadedRecords, setStep2UploadedRecords] = useState<DonationRecord[]>([]);
  const [step2UploadedRows, setStep2UploadedRows] = useState<Record<string, string>[]>([]);
  const [letterTemplateFile, setLetterTemplateFile] = useState<File | null>(null);
  const [letterTemplateText, setLetterTemplateText] = useState<string>("");
  const [letterTemplateBuffer, setLetterTemplateBuffer] = useState<ArrayBuffer | null>(
    null,
  );
  const [templateParameters, setTemplateParameters] = useState<string[]>([]);
  const [donorDatabaseFile, setDonorDatabaseFile] = useState<File | null>(null);
  const [donorEmailMap, setDonorEmailMap] = useState<Map<string, string>>(new Map());
  const [step2SpreadsheetSource, setStep2SpreadsheetSource] = useState<
    "upload" | "current"
  >("current");
  const [step2YearOverride, setStep2YearOverride] = useState<string>("");
  const [letterFormat, setLetterFormat] = useState<LetterFormat>("word");
  const [donationsViewMode, setDonationsViewMode] =
    useState<DonationsViewMode>("individual");
  const [groupIndividualByPerson, setGroupIndividualByPerson] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [individualSortKey, setIndividualSortKey] =
    useState<IndividualSortKey>("name");
  const [totalSortKey, setTotalSortKey] = useState<TotalSortKey>("name");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const panelParam = params.get("panel");
    if (panelParam === null) {
      setShowLanding(true);
      return;
    }

    setShowLanding(false);
    const panelValue = Number(panelParam);
    if (Number.isInteger(panelValue) && panelValue >= 0 && panelValue <= 4) {
      setCurrentPanel(panelValue);
    }
  }, []);

  const enrichedActiveDonations = useMemo(() => {
    return applyDonorEmails(activeBatch?.donations ?? [], donorEmailMap);
  }, [activeBatch, donorEmailMap]);

  const enrichedUploadedRecords = useMemo(() => {
    return applyDonorEmails(step2UploadedRecords, donorEmailMap);
  }, [step2UploadedRecords, donorEmailMap]);

  const recordsForLetterGeneration = useMemo(() => {
    if (step2SpreadsheetSource === "upload") {
      return enrichedUploadedRecords;
    }
    return enrichedActiveDonations;
  }, [enrichedActiveDonations, enrichedUploadedRecords, step2SpreadsheetSource]);

  const groupedByDonor = useMemo(() => {
    const grouped = new Map<string, DonationRecord[]>();
    for (const row of recordsForLetterGeneration) {
      const existing = grouped.get(row.name) ?? [];
      existing.push(row);
      grouped.set(row.name, existing);
    }

    return Array.from(grouped.entries()).sort(([nameA], [nameB]) =>
      nameA.localeCompare(nameB),
    );
  }, [recordsForLetterGeneration]);

  const donorTotals = useMemo(() => {
    const totals = new Map<string, DonorTotalRow>();

    for (const row of enrichedActiveDonations) {
      const existing = totals.get(row.name);
      const email = row.email && row.email !== "N/A" ? row.email : "N/A";

      if (!existing) {
        totals.set(row.name, {
          name: row.name,
          email,
          donationCount: 1,
          totalAmount: amountToNumber(row.amount),
        });
      } else {
        existing.donationCount += 1;
        existing.totalAmount += amountToNumber(row.amount);
        if (existing.email === "N/A" && email !== "N/A") {
          existing.email = email;
        }
      }
    }

    return Array.from(totals.values());
  }, [enrichedActiveDonations]);

  const sortedIndividualDonations = useMemo(() => {
    const rows = [...enrichedActiveDonations];
    rows.sort((a, b) => {
      if (individualSortKey === "amount") {
        return amountToNumber(a.amount) - amountToNumber(b.amount);
      }
      return (a[individualSortKey] ?? "").localeCompare(b[individualSortKey] ?? "");
    });
    if (sortDirection === "desc") {
      rows.reverse();
    }
    return rows;
  }, [enrichedActiveDonations, individualSortKey, sortDirection]);

  const sortedTotalRows = useMemo(() => {
    const rows = [...donorTotals];
    rows.sort((a, b) => {
      if (totalSortKey === "totalAmount") {
        return a.totalAmount - b.totalAmount;
      }
      if (totalSortKey === "donationCount") {
        return a.donationCount - b.donationCount;
      }
      return (a[totalSortKey] ?? "").localeCompare(b[totalSortKey] ?? "");
    });
    if (sortDirection === "desc") {
      rows.reverse();
    }
    return rows;
  }, [donorTotals, sortDirection, totalSortKey]);

  const groupedIndividualDonations = useMemo(() => {
    const grouped = new Map<string, DonationRecord[]>();
    for (const row of sortedIndividualDonations) {
      const rows = grouped.get(row.name) ?? [];
      rows.push(row);
      grouped.set(row.name, rows);
    }

    const donors = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
    if (sortDirection === "desc") {
      donors.reverse();
    }
    return donors;
  }, [sortedIndividualDonations, sortDirection]);

  const statementYear = useMemo(() => {
    if (!activeBatch) {
      return undefined;
    }
    return inferStatementYear(activeBatch.batch.fileNames);
  }, [activeBatch]);

  const uploadedSpreadsheetYear = useMemo(() => {
    for (const row of enrichedUploadedRecords) {
      const match = row.date.match(/(20\d{2})/);
      if (match) {
        const year = Number(match[1]);
        if (Number.isFinite(year) && year >= 2000 && year <= 2099) {
          return year;
        }
      }
    }
    return undefined;
  }, [enrichedUploadedRecords]);

  const effectiveLetterYear = useMemo(() => {
    const override = parseYearOverride(step2YearOverride);
    if (override !== undefined) {
      return override;
    }
    return step2SpreadsheetSource === "upload"
      ? uploadedSpreadsheetYear
      : statementYear;
  }, [statementYear, step2YearOverride, step2SpreadsheetSource, uploadedSpreadsheetYear]);

  const canGenerateLetters = useMemo(() => {
    if (step2SpreadsheetSource === "upload") {
      return step2UploadedRows.length > 0 || groupedByDonor.length > 0;
    }
    return groupedByDonor.length > 0;
  }, [groupedByDonor.length, step2SpreadsheetSource, step2UploadedRows.length]);

  const visibleTemplateParameters = useMemo(
    () => templateParameters.filter((param) => !isTodaysDateToken(param)),
    [templateParameters],
  );

  useEffect(() => {
    if (activeBatch) {
      setStep2SpreadsheetSource("current");
    } else {
      setStep2SpreadsheetSource("upload");
    }
  }, [activeBatch]);

  const loadBatchDetails = useCallback(async (batchId: string) => {
    setError(null);
    const response = await fetch(`/api/batches/${batchId}`, { cache: "no-store" });

    if (!response.ok) {
      setError("Failed to fetch records for this batch.");
      return;
    }

    const data = (await response.json()) as BatchDetail;
    setActiveBatch(data);
  }, []);

  const loadBatches = useCallback(async () => {
    const response = await fetch("/api/batches", { cache: "no-store" });
    if (!response.ok) {
      setError("Could not load batch history.");
      return;
    }

    const data = (await response.json()) as { batches: BatchSummary[] };
    setBatches(data.batches);
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (files.length === 0) {
      setError("Please choose at least one statement PDF.");
      return;
    }

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    setIsUploading(true);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Extraction failed.");
      }

      setInvalidLines(data.invalidLines ?? 0);
      setInvalidExamples(Array.isArray(data.invalidExamples) ? data.invalidExamples : []);
      await loadBatches();

      if (data.batchId) {
        setSelectedBatchId(data.batchId);
        await loadBatchDetails(data.batchId);
        setCurrentPanel(1);
      }

      setFiles([]);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = "";
      }
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : "Could not process PDFs.";
      setError(message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleDownloadSpreadsheet() {
    if (enrichedActiveDonations.length === 0) {
      setError("No extracted records available for spreadsheet download.");
      return;
    }

    const csv = donationsToCsv(enrichedActiveDonations, statementYear);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contributions_${selectedBatchId || "batch"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleCampPaymentSheetChange(file: File | null) {
    setCampPaymentSheetFile(file);
    if (!file) {
      setCampPayments([]);
      return;
    }

    try {
      const rows = parseCampPaymentsCsv(await file.text());
      setCampPayments(rows);
      setError(null);
    } catch (parseError) {
      setCampPayments([]);
      setError(parseError instanceof Error ? parseError.message : "Could not parse payment sheet.");
    }
  }

  async function handleCampDataSheetChange(file: File | null) {
    setCampDataFile(file);
    if (!file) {
      return;
    }

    try {
      const campDirectory = await parseCampDirectoryFile(file);
      setCampPayments((prev) => mergeCampData(prev, campDirectory));
      setError(null);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not parse camp data sheet.");
    }
  }

  async function handleGenerateCampReceipts() {
    if (campPayments.length === 0) {
      setError("Load a camp payment spreadsheet first.");
      return;
    }

    setIsGeneratingCampLetters(true);
    setError(null);
    try {
      const campTemplateText = campTemplateFile
        ? await readCampTemplateText(campTemplateFile)
        : undefined;
      const byParent = new Map<string, CampPaymentRow[]>();
      for (const row of campPayments) {
        const rows = byParent.get(row.paidBy) ?? [];
        rows.push(row);
        byParent.set(row.paidBy, rows);
      }

      const zip = new JSZip();
      for (const [parentName, rows] of byParent) {
        const blob = await getCampReceiptLetterBlob(parentName, rows, campTemplateText);
        const safeName = parentName.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
        zip.file(`Camp_Receipt_${safeName}.pdf`, blob);

        const email = rows.find((r) => isValidDonorEmail(r.email))?.email;
        if (campSendEmailConfirm && email && window.confirm(`Send email to ${parentName} (${email})?`)) {
          const subject = encodeURIComponent("AAPASD Summer Camp Receipt");
          const body = encodeURIComponent(
            `Dear ${parentName},\n\nPlease find your summer camp payment receipt attached/downloaded from the portal.\n\nBest regards,\nAAPASD Team`,
          );
          window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = "AAPASD_Camp_Receipts.zip";
      link.click();
      URL.revokeObjectURL(zipUrl);
    } finally {
      setIsGeneratingCampLetters(false);
    }
  }

  async function handleDownloadAllLetters() {
    if (!canGenerateLetters) {
      return;
    }

    setError(null);
    setIsDownloadingAll(true);

    try {
      const zip = new JSZip();

      if (
        letterTemplateBuffer &&
        step2SpreadsheetSource === "upload" &&
        step2UploadedRows.length > 0
      ) {
        for (let index = 0; index < step2UploadedRows.length; index += 1) {
          const row = step2UploadedRows[index];
          const donorName =
            row["Name"] || row["Donor Name"] || row["Parent Name"] || `Row_${index + 1}`;

          const replacements = buildTemplateReplacementsFromRow(
            row,
            donorName,
            groupedByDonor.find(([name]) => name === donorName)?.[1] ?? [],
            effectiveLetterYear,
            templateParameters,
          );
          const blob = await renderDocxTemplate(letterTemplateBuffer, replacements);
          zip.file(getDocxLetterFileName(donorName), blob);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipUrl = URL.createObjectURL(zipBlob);
        const link = document.createElement("a");
        link.href = zipUrl;
        link.download = `AAPASD_Thank_You_Letters_docx_${selectedBatchId || "batch"}.zip`;
        link.click();
        URL.revokeObjectURL(zipUrl);
        return;
      }

      for (const [donorName, donations] of groupedByDonor) {
        if (letterTemplateBuffer) {
          const replacements = buildDonorTemplateReplacements(
            donorName,
            donations,
            effectiveLetterYear,
            templateParameters,
          );
          const blob = await renderDocxTemplate(letterTemplateBuffer, replacements);
          zip.file(getDocxLetterFileName(donorName), blob);
        } else if (letterFormat === "word") {
          const blob = await getThankYouLetterWordBlob(
            donorName,
            donations,
            {
              statementYear: effectiveLetterYear,
              templateText: letterTemplateText,
            },
          );
          zip.file(getThankYouLetterWordFileName(donorName), blob);
        } else {
          const blob = await getThankYouLetterBlob(
            donorName,
            donations,
            {
              statementYear: effectiveLetterYear,
              templateText: letterTemplateText,
            },
          );
          zip.file(getThankYouLetterFileName(donorName), blob);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipUrl;
      const formatName = letterTemplateBuffer ? "docx" : letterFormat;
      link.download = `AAPASD_Thank_You_Letters_${formatName}_${selectedBatchId || "batch"}.zip`;
      link.click();
      URL.revokeObjectURL(zipUrl);
    } catch {
      setError("Failed to generate ZIP file for all letters.");
    } finally {
      setIsDownloadingAll(false);
    }
  }

  async function handleStep2CsvFileChange(file: File | null) {
    setStep2Spreadsheet(file);
    setStep2SpreadsheetSource("upload");
    if (!file) {
      setStep2UploadedRecords([]);
      setStep2UploadedRows([]);
      return;
    }

    try {
      const text = await file.text();
      const genericRows = parseCsvRowsGeneric(text);
      setStep2UploadedRows(genericRows);

      if (letterTemplateFile) {
        const bestEffortRecords: DonationRecord[] = genericRows
          .map((row) => {
            const name =
              row["Name"] || row["Donor Name"] || row["Parent Name"] || row["Parent/Guardian Name"] || "";
            const date = row["Date"] || row["Contribution Date"] || row["Payment Date"] || "";
            const amount = row["Amount"] || "";
            const paymentType = row["Payment Type"] || "";
            const email = row["Email"] || "N/A";

            if (!name || !date || !amount) {
              return null;
            }

            return { name, date, amount, paymentType, email } as DonationRecord;
          })
          .filter((row): row is DonationRecord => Boolean(row));

        setStep2UploadedRecords(bestEffortRecords);
      } else {
        const records = parseDonationsCsv(text);
        setStep2UploadedRecords(records);
      }

      setError(null);
    } catch (csvError) {
      setStep2UploadedRecords([]);
      setStep2UploadedRows([]);
      const message =
        csvError instanceof Error
          ? csvError.message
          : "Could not parse uploaded CSV.";
      setError(message);
    }
  }

  async function handleDonorDatabaseFileChange(file: File | null) {
    setDonorDatabaseFile(file);
    if (!file) {
      setDonorEmailMap(new Map());
      return;
    }

    try {
      const parsedMap = await parseDonorDatabaseFile(file);
      setDonorEmailMap(parsedMap);
      setError(null);
    } catch (dbError) {
      setDonorEmailMap(new Map());
      const message =
        dbError instanceof Error
          ? dbError.message
          : "Could not parse donor database file.";
      setError(message);
    }
  }

  async function handleLetterTemplateFileChange(file: File | null) {
    setLetterTemplateFile(file);
    if (!file) {
      setLetterTemplateText("");
      setLetterTemplateBuffer(null);
      setTemplateParameters([]);
      return;
    }

    try {
      const extractedText = await readDonorTemplateText(file);
      setLetterTemplateText(extractedText);
      setTemplateParameters(extractTemplateParameters(extractedText));

      if (file.name.toLowerCase().endsWith(".docx")) {
        setLetterTemplateBuffer(await file.arrayBuffer());
      } else {
        setLetterTemplateBuffer(null);
      }
      setError(null);
    } catch (templateError) {
      setLetterTemplateText("");
      setLetterTemplateBuffer(null);
      setTemplateParameters([]);
      const message =
        templateError instanceof Error
          ? templateError.message
          : "Could not parse letter template file.";
      setError(message);
    }
  }

  function handleSendEmailToDonor(donorName: string, donations: DonationRecord[]) {
    const validEmail = donations
      .map((row) => row.email)
      .find((email) => isValidDonorEmail(email));

    if (!validEmail) {
      return;
    }

    const total = donations.reduce((sum, row) => sum + amountToNumber(row.amount), 0);
    const subject = encodeURIComponent("AAPASD Thank You");
    const body = encodeURIComponent(
      `Dear ${donorName},\n\nThank you for your support of AAPASD.\nTotal recorded donations: $${total.toFixed(2)} across ${donations.length} contribution(s).\n\nBest regards,\nAAPASD Team`,
    );

    window.open(`mailto:${validEmail}?subject=${subject}&body=${body}`, "_blank");
  }

  const panelTitles = [
    "Extract",
    "Spreadsheet Preview",
    "Generate Letters",
    "Summer Camp Workflow",
    "Letter Downloads",
  ];

  function goToPanel(nextIndex: number) {
    const bounded = Math.max(0, Math.min(panelTitles.length - 1, nextIndex));
    if (bounded === 0 && currentPanel !== 0) {
      setSelectedBatchId("");
      setActiveBatch(null);
      setFiles([]);
      setError(null);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = "";
      }
    }
    setCurrentPanel(bounded);
  }

  function handleSwipeStart(event: React.TouchEvent<HTMLElement>) {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
    touchStartYRef.current = event.changedTouches[0]?.clientY ?? null;
  }

  function handleSwipeEnd(event: React.TouchEvent<HTMLElement>) {
    if (touchStartXRef.current === null || touchStartYRef.current === null) {
      return;
    }

    const endX = event.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const endY = event.changedTouches[0]?.clientY ?? touchStartYRef.current;
    const deltaX = endX - touchStartXRef.current;
    const deltaY = endY - touchStartYRef.current;

    if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        goToPanel(currentPanel + 1);
      } else {
        goToPanel(currentPanel - 1);
      }
    }

    touchStartXRef.current = null;
    touchStartYRef.current = null;
  }

  if (showLanding) {
    return (
      <main className="landing-shell">
        <div className="landing-bg" aria-hidden>
          <span className="landing-orb orb-a" />
          <span className="landing-orb orb-b" />
          <span className="landing-orb orb-c" />
          <span className="landing-grid" />
        </div>

        <section className="landing-hero card">
          <p className="landing-kicker">AAPASD Donor Operations</p>
          <h1 className="landing-title">From statements to donor-ready letters in one streamlined flow</h1>
          <p className="landing-copy">
            Extract records from bank PDFs, validate spreadsheets, generate polished thank-you letters,
            and run summer camp receipt workflows with less manual work.
          </p>
          <div className="landing-actions">
            <Link className="cta-btn" href="/login?next=/?panel=0">
              Start Extraction
            </Link>
            <Link className="secondary-btn" href="/home">
              Open Workspace Pages
            </Link>
          </div>
        </section>

        <section className="landing-feature-grid">
          <article className="landing-feature-card">
            <h2>Extraction</h2>
            <p>Upload one or many statement PDFs and capture normalized donation rows with source tracking.</p>
          </article>
          <article className="landing-feature-card">
            <h2>Letters</h2>
            <p>Generate personalized PDF/Word/DOCX letters from templates and spreadsheet-driven parameters.</p>
          </article>
          <article className="landing-feature-card">
            <h2>Camp Workflow</h2>
            <p>Merge camp payments and directory data, then create receipts and optional email drafts quickly.</p>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <>
      <section className="panel-nav">
        <div className="panel-nav-head">
          <p className="hero-kicker">Workflow Panels</p>
          <p className="muted-text">
            {currentPanel + 1}/{panelTitles.length} - {panelTitles[currentPanel]}
          </p>
        </div>
        <div className="panel-nav-actions">
          <button
            type="button"
            className="secondary-btn"
            disabled={currentPanel === 0}
            onClick={() => goToPanel(currentPanel - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={currentPanel === panelTitles.length - 1}
            onClick={() => goToPanel(currentPanel + 1)}
          >
            Next
          </button>
        </div>
      </section>

      <div className="swipe-surface" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
      <section className={`dashboard-grid records-panel step-card ${currentPanel === 0 ? "" : "is-hidden"}`}>
        <article className="card">
          <h2 className="card-title">Extract</h2>
          <form onSubmit={handleUpload} className="stack-sm">
            <div className="history-inline">
              <h3 className="history-title">Previous Extractions</h3>
              <label className="input-label" htmlFor="batch-select">
                Extraction history
              </label>
              <select
                id="batch-select"
                className="select-input"
                value={selectedBatchId}
                onChange={async (event) => {
                  const batchId = event.currentTarget.value;
                  setSelectedBatchId(batchId);
                if (batchId) {
                  await loadBatchDetails(batchId);
                  setCurrentPanel(1);
                } else {
                  setActiveBatch(null);
                }
              }}
              >
                <option value="">Select a previous extraction</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch._id}>
                    {new Date(batch.createdAt).toLocaleString()} - {batch.totalRecords}{" "}
                    records
                  </option>
                ))}
              </select>
              {activeBatch ? (
                <p className="muted-text">
                  Files: {activeBatch.batch.fileNames.join(", ")} | Total records:{" "}
                  {activeBatch.batch.totalRecords}
                </p>
              ) : (
                <p className="muted-text">No extraction selected.</p>
              )}
            </div>

            <label className="input-label" htmlFor="pdf-upload">
              Statement files
            </label>
            <input
              id="pdf-upload"
              ref={pdfInputRef}
              type="file"
              multiple
              accept="application/pdf"
              onChange={(event) =>
                setFiles(Array.from(event.currentTarget.files ?? []))
              }
              className="file-input"
            />
            <button disabled={isUploading} type="submit" className="cta-btn">
              {isUploading ? "Extracting..." : "Extract Data"}
            </button>
            <p className="muted-text">
              {files.length > 0
                ? `${files.length} file(s) selected`
                : "No files selected yet"}
            </p>
            {invalidLines > 0 ? (
              <p className="warning-text">
                {invalidLines} payment line(s) were skipped due to format mismatch.
              </p>
            ) : null}
            {invalidExamples.length > 0 ? (
              <details>
                <summary className="muted-text">Show skipped lines</summary>
                <ul className="invalid-list">
                  {invalidExamples.map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
          </form>
        </article>
      </section>

      <section className={`records-panel step-card ${currentPanel === 1 ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <h2 className="card-title">Spreadsheet Preview</h2>
          <div className="panel-actions">
            <span className="pill">
              {donationsViewMode === "individual"
                ? `${sortedIndividualDonations.length} donations`
                : `${sortedTotalRows.length} donors`}
            </span>
            {enrichedActiveDonations.length > 0 ? (
              <button
                type="button"
                className="icon-btn"
                onClick={handleDownloadSpreadsheet}
                title="Download Data Spreadsheet"
                aria-label="Download Data Spreadsheet"
              >
                <Download size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="controls-row">
          <label className="input-label" htmlFor="view-mode-toggle">
            View
          </label>
          <select
            id="view-mode-toggle"
            className="select-input"
            value={donationsViewMode}
            onChange={(event) =>
              setDonationsViewMode(event.currentTarget.value as DonationsViewMode)
            }
          >
            <option value="individual">Individual donations</option>
            <option value="totals">Total per person</option>
          </select>

          {donationsViewMode === "individual" ? (
            <>
              <label className="input-label" htmlFor="individual-sort">
                Sort by
              </label>
              <select
                id="individual-sort"
                className="select-input"
                value={individualSortKey}
                onChange={(event) =>
                  setIndividualSortKey(
                    event.currentTarget.value as IndividualSortKey,
                  )
                }
              >
                <option value="name">Name</option>
                <option value="date">Date</option>
                <option value="amount">Amount</option>
                <option value="paymentType">Payment Type</option>
                <option value="email">Email</option>
              </select>

              <label className="checkbox-inline" htmlFor="group-individual-toggle">
                <input
                  id="group-individual-toggle"
                  type="checkbox"
                  checked={groupIndividualByPerson}
                  onChange={(event) =>
                    setGroupIndividualByPerson(event.currentTarget.checked)
                  }
                />
                Group by person
              </label>
            </>
          ) : (
            <>
              <label className="input-label" htmlFor="totals-sort">
                Sort by
              </label>
              <select
                id="totals-sort"
                className="select-input"
                value={totalSortKey}
                onChange={(event) =>
                  setTotalSortKey(event.currentTarget.value as TotalSortKey)
                }
              >
                <option value="name">Name</option>
                <option value="totalAmount">Total Amount</option>
                <option value="donationCount">Donation Count</option>
                <option value="email">Email</option>
              </select>
            </>
          )}

          <label className="input-label" htmlFor="sort-direction-toggle">
            Direction
          </label>
          <select
            id="sort-direction-toggle"
            className="select-input"
            value={sortDirection}
            onChange={(event) =>
              setSortDirection(event.currentTarget.value as SortDirection)
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>

        <div className="table-wrap">
          {donationsViewMode === "totals" ? (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Donation Count</th>
                  <th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {sortedTotalRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{row.donationCount}</td>
                    <td>${row.totalAmount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Payment Type</th>
                  <th>Email</th>
                  <th>Source File</th>
                </tr>
              </thead>
              <tbody>
                {groupIndividualByPerson
                  ? groupedIndividualDonations.flatMap(([donorName, rows]) => [
                      <tr key={`group-${donorName}`} className="group-row">
                        <td colSpan={6}>
                          <strong>{donorName}</strong> - {rows.length} donation(s)
                        </td>
                      </tr>,
                      ...rows.map((record, index) => (
                        <tr key={`${record.name}-${record.date}-${index}`}>
                          <td>{record.name}</td>
                          <td>{record.date}</td>
                          <td>{record.amount}</td>
                          <td>{record.paymentType}</td>
                          <td>{record.email}</td>
                          <td>{record.sourceFileName ?? "N/A"}</td>
                        </tr>
                      )),
                    ])
                  : sortedIndividualDonations.map((record, index) => (
                      <tr key={`${record.name}-${record.date}-${index}`}>
                        <td>{record.name}</td>
                        <td>{record.date}</td>
                        <td>{record.amount}</td>
                        <td>{record.paymentType}</td>
                        <td>{record.email}</td>
                        <td>{record.sourceFileName ?? "N/A"}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className={`records-panel step-card ${currentPanel === 2 ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <h2 className="card-title">Generate Letters</h2>
        </div>
        <form className="stack-sm">
          <label className="input-label" htmlFor="letter-template-file">
            Letter Template (upload this first)
          </label>
          <input
            id="letter-template-file"
            className="file-input"
            type="file"
            accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              void handleLetterTemplateFileChange(event.currentTarget.files?.[0] ?? null);
            }}
          />
          <p className="muted-text">
            {letterTemplateFile
              ? `Template loaded: ${letterTemplateFile.name}`
              : "Upload a template first. Then the app detects required parameters from brackets."}
          </p>

          <label className="input-label" htmlFor="step2-spreadsheet-source">
            Spreadsheet source
          </label>
          <select
            id="step2-spreadsheet-source"
            className="select-input"
            value={step2SpreadsheetSource}
            disabled={!letterTemplateFile}
            onChange={(event) =>
              setStep2SpreadsheetSource(
                event.currentTarget.value as "upload" | "current",
              )
            }
          >
            <option value="upload">Upload CSV file</option>
            <option value="current" disabled={!activeBatch}>
              Use current spreadsheet preview
            </option>
          </select>

          {step2SpreadsheetSource === "current" ? (
            <p className="muted-text">
              Using the currently selected batch preview ({activeBatch?.donations.length ?? 0} rows).
            </p>
          ) : null}

          {step2SpreadsheetSource === "upload" ? (
            <>
          <label className="input-label" htmlFor="step2-csv">
            Contributions spreadsheet (CSV)
          </label>
          <input
            id="step2-csv"
            className="file-input"
            type="file"
            accept=".csv,text/csv"
            disabled={!letterTemplateFile}
            onChange={(event) => {
              void handleStep2CsvFileChange(event.currentTarget.files?.[0] ?? null);
            }}
          />
          <p className="muted-text">
            {step2Spreadsheet
              ? `Loaded ${
                  letterTemplateFile ? step2UploadedRows.length : step2UploadedRecords.length
                } rows from ${step2Spreadsheet.name}`
              : "Upload a contributions CSV to generate donor letters from file."}
          </p>
          {visibleTemplateParameters.length > 0 ? (
            <p className="muted-text">
              Template parameters: {visibleTemplateParameters
                .map((param) => `[${param}]`)
                .join(", ")}
            </p>
          ) : null}
          <p className="muted-text">
            CSV format: first row is column labels (no brackets), and each next row is one letter&apos;s data.
          </p>
            </>
          ) : null}

          <label className="input-label" htmlFor="donor-db-file">
            Donor Emails (CSV/Excel with names + emails)
          </label>
          <input
            id="donor-db-file"
            className="file-input"
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            disabled={!letterTemplateFile}
            onChange={(event) => {
              void handleDonorDatabaseFileChange(event.currentTarget.files?.[0] ?? null);
            }}
          />
          <p className="muted-text">
            {donorDatabaseFile
              ? `Loaded ${donorEmailMap.size} donor email(s) from ${donorDatabaseFile.name}`
              : "Optional: upload donor emails to replace N/A emails automatically."}
          </p>

          <label className="input-label" htmlFor="step2-year-override">
            Donation year override (optional)
          </label>
          <input
            id="step2-year-override"
            className="file-input"
            type="number"
            min={2000}
            max={2099}
            disabled={!letterTemplateFile}
            placeholder={statementYear ? `Detected: ${statementYear}` : "Detected automatically"}
            value={step2YearOverride}
            onChange={(event) =>
              setStep2YearOverride(event.currentTarget.value)
            }
          />

          <p className="muted-text">
            If left blank, year is auto-detected from selected statement batch or spreadsheet rows.
          </p>
          <label className="input-label" htmlFor="step2-letter-format">
            Letter format
          </label>
          <select
            id="step2-letter-format"
            className="select-input"
            value={letterFormat}
            disabled={!letterTemplateFile}
            onChange={(event) =>
              setLetterFormat(event.currentTarget.value as LetterFormat)
            }
          >
            <option value="pdf">PDF (.pdf)</option>
            <option value="word">Word (.doc)</option>
          </select>
          <p className="muted-text">
            Current letter year for on-page donor downloads: {effectiveLetterYear ?? "Auto"}
          </p>
          <button
            type="button"
            className="cta-btn"
            disabled={!letterTemplateFile || !canGenerateLetters || isDownloadingAll}
            onClick={() => {
              void handleDownloadAllLetters();
            }}
          >
            {isDownloadingAll ? "Generating..." : "Generate"}
          </button>
        </form>
      </section>

      <section className={`records-panel step-card ${currentPanel === 3 ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <h2 className="card-title">Summer Camp Workflow</h2>
        </div>
        <form className="stack-sm" onSubmit={(event) => event.preventDefault()}>
          <p className="muted-text">
            Step 1 output: camp payment spreadsheet (Payment Date, Amount, Paid By)
          </p>

          <label className="input-label" htmlFor="camp-payment-sheet">
            Step 2 input: Payment spreadsheet (CSV)
          </label>
          <input
            id="camp-payment-sheet"
            className="file-input"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={(event) => {
              void handleCampPaymentSheetChange(event.currentTarget.files?.[0] ?? null);
            }}
          />

          <label className="input-label" htmlFor="camp-data-sheet">
            Step 2 input: Camp Data sheet (CSV/Excel)
          </label>
          <input
            id="camp-data-sheet"
            className="file-input"
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(event) => {
              void handleCampDataSheetChange(event.currentTarget.files?.[0] ?? null);
            }}
          />

          <label className="input-label" htmlFor="camp-template-file">
            Step 3 input: Camp letter template (optional)
          </label>
          <input
            id="camp-template-file"
            className="file-input"
            type="file"
            accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setCampTemplateFile(event.currentTarget.files?.[0] ?? null)}
          />

          <label className="checkbox-inline" htmlFor="camp-send-email-confirm">
            <input
              id="camp-send-email-confirm"
              type="checkbox"
              checked={campSendEmailConfirm}
              onChange={(event) => setCampSendEmailConfirm(event.currentTarget.checked)}
            />
            Ask Yes/No before opening each email draft
          </label>

          <p className="muted-text">
            Loaded payment rows: {campPayments.length}
            {campPaymentSheetFile ? ` from ${campPaymentSheetFile.name}` : ""}
          </p>
          <p className="muted-text">
            Camp data file: {campDataFile ? campDataFile.name : "Not uploaded"}
          </p>
          <p className="muted-text">
            Template file: {campTemplateFile ? campTemplateFile.name : "Default template in app"}
          </p>

          <button
            type="button"
            className="cta-btn"
            disabled={campPayments.length === 0 || isGeneratingCampLetters}
            onClick={() => {
              void handleGenerateCampReceipts();
            }}
          >
            {isGeneratingCampLetters
              ? "Generating camp receipts..."
              : "Generate Camp Receipts + Email Drafts"}
          </button>
        </form>
      </section>

      <section className={`records-panel step-card ${currentPanel === 4 ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <h2 className="card-title">Letter Downloads</h2>
          <div className="panel-actions">
            <span className="pill">{groupedByDonor.length} donors</span>
            <button
              type="button"
              className="secondary-btn"
              disabled={!canGenerateLetters || isDownloadingAll}
              onClick={handleDownloadAllLetters}
            >
              {isDownloadingAll ? "Preparing ZIP..." : "Download All (ZIP)"}
            </button>
          </div>
        </div>

        <div className="donor-grid">
          {groupedByDonor.map(([donorName, donations]) => {
            const total = donations.reduce((sum, row) => {
              const amount = Number(row.amount.replaceAll("$", "").replaceAll(",", ""));
              return Number.isFinite(amount) ? sum + amount : sum;
            }, 0);
            const donorEmail =
              donations.map((row) => row.email).find((email) => isValidDonorEmail(email)) ??
              "N/A";
            return (
              <article key={donorName} className="donor-card">
                <h3>{donorName}</h3>
                <p>
                  {donations.length} donation(s) - ${total.toFixed(2)} total
                </p>
                <p className="muted-text">Email: {donorEmail}</p>
                <button
                  type="button"
                  className="secondary-btn donor-btn donor-btn-email"
                  disabled={donorEmail === "N/A"}
                  onClick={() => handleSendEmailToDonor(donorName, donations)}
                >
                  {donorEmail === "N/A" ? "No valid email" : "Send email"}
                </button>
                <button
                  type="button"
                  className="secondary-btn donor-btn donor-btn-download"
                  onClick={async () => {
                    if (letterTemplateBuffer) {
                      const replacements = buildDonorTemplateReplacements(
                        donorName,
                        donations,
                        effectiveLetterYear,
                        templateParameters,
                      );
                      const blob = await renderDocxTemplate(letterTemplateBuffer, replacements);
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = getDocxLetterFileName(donorName);
                      link.click();
                      URL.revokeObjectURL(url);
                      return;
                    }

                    if (letterFormat === "word") {
                      await downloadThankYouLetterWord(
                        donorName,
                        donations,
                        {
                          statementYear: effectiveLetterYear,
                          templateText: letterTemplateText,
                        },
                      );
                    } else {
                      await downloadThankYouLetter(
                        donorName,
                        donations,
                        {
                          statementYear: effectiveLetterYear,
                          templateText: letterTemplateText,
                        },
                      );
                    }
                  }}
                >
                  {letterTemplateBuffer
                    ? "Download letter DOCX"
                    : letterFormat === "word"
                      ? "Download letter Word"
                      : "Download letter PDF"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
      </div>
      </>
    </main>
  );
}
