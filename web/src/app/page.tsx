"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import {
  downloadThankYouLetter,
  downloadThankYouLetterWord,
  getThankYouLetterBlob,
  getThankYouLetterFileName,
  getThankYouLetterWordBlob,
  getThankYouLetterWordFileName,
} from "@/lib/letterPdf";
import { donationsToCsv, parseDonationsCsv } from "@/lib/spreadsheet";
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

const APP_PASSWORD = "dataextraction";

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

export default function Home() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [activeBatch, setActiveBatch] = useState<BatchDetail | null>(null);
  const [invalidLines, setInvalidLines] = useState<number>(0);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [step2Spreadsheet, setStep2Spreadsheet] = useState<File | null>(null);
  const [step2SpreadsheetSource, setStep2SpreadsheetSource] = useState<
    "upload" | "current"
  >("current");
  const [step2YearOverride, setStep2YearOverride] = useState<string>("");
  const [letterFormat, setLetterFormat] = useState<LetterFormat>("pdf");
  const [donationsViewMode, setDonationsViewMode] =
    useState<DonationsViewMode>("individual");
  const [groupIndividualByPerson, setGroupIndividualByPerson] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [individualSortKey, setIndividualSortKey] =
    useState<IndividualSortKey>("name");
  const [totalSortKey, setTotalSortKey] = useState<TotalSortKey>("name");

  const groupedByDonor = useMemo(() => {
    if (!activeBatch) {
      return [];
    }

    const grouped = new Map<string, DonationRecord[]>();
    for (const row of activeBatch.donations) {
      const existing = grouped.get(row.name) ?? [];
      existing.push(row);
      grouped.set(row.name, existing);
    }

    return Array.from(grouped.entries()).sort(([nameA], [nameB]) =>
      nameA.localeCompare(nameB),
    );
  }, [activeBatch]);

  const donorTotals = useMemo(() => {
    const totals = new Map<string, DonorTotalRow>();

    for (const row of activeBatch?.donations ?? []) {
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
  }, [activeBatch]);

  const sortedIndividualDonations = useMemo(() => {
    const rows = [...(activeBatch?.donations ?? [])];
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
  }, [activeBatch, individualSortKey, sortDirection]);

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

  const effectiveLetterYear = useMemo(() => {
    return parseYearOverride(step2YearOverride) ?? statementYear;
  }, [statementYear, step2YearOverride]);

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
      await loadBatches();

      if (data.batchId) {
        setSelectedBatchId(data.batchId);
        await loadBatchDetails(data.batchId);
      }

      setFiles([]);
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
    if (!activeBatch || activeBatch.donations.length === 0) {
      setError("No extracted records available for spreadsheet download.");
      return;
    }

    const csv = donationsToCsv(activeBatch.donations);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contributions_${selectedBatchId || "batch"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadAllLetters() {
    if (groupedByDonor.length === 0) {
      return;
    }

    setError(null);
    setIsDownloadingAll(true);

    try {
      const zip = new JSZip();

      for (const [donorName, donations] of groupedByDonor) {
        if (letterFormat === "word") {
          const blob = await getThankYouLetterWordBlob(
            donorName,
            donations,
            effectiveLetterYear,
          );
          zip.file(getThankYouLetterWordFileName(donorName), blob);
        } else {
          const blob = await getThankYouLetterBlob(
            donorName,
            donations,
            effectiveLetterYear,
          );
          zip.file(getThankYouLetterFileName(donorName), blob);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = `AAPASD_Thank_You_Letters_${letterFormat}_${selectedBatchId || "batch"}.zip`;
      link.click();
      URL.revokeObjectURL(zipUrl);
    } catch {
      setError("Failed to generate ZIP file for all letters.");
    } finally {
      setIsDownloadingAll(false);
    }
  }

  async function handleStep2(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (step2SpreadsheetSource === "upload" && !step2Spreadsheet) {
      setError("Step 2 requires a spreadsheet CSV upload or choose current preview.");
      return;
    }

    if (step2SpreadsheetSource === "current" && !activeBatch) {
      setError("No current spreadsheet preview available. Select or extract a batch.");
      return;
    }

    try {
      const records =
        step2SpreadsheetSource === "current"
          ? activeBatch?.donations ?? []
          : parseDonationsCsv(await step2Spreadsheet!.text());

      if (records.length === 0) {
        throw new Error("No donation rows found in the spreadsheet.");
      }

      const grouped = new Map<string, DonationRecord[]>();
      for (const row of records) {
        const donorRows = grouped.get(row.name) ?? [];
        donorRows.push(row);
        grouped.set(row.name, donorRows);
      }

      const zip = new JSZip();
      for (const [donorName, donations] of grouped) {
        const firstYearMatch = donations[0]?.date.match(/(20\d{2})/);
        const inferredYearFromRows = firstYearMatch
          ? Number(firstYearMatch[1])
          : undefined;
        const overrideYear = parseYearOverride(step2YearOverride);
        const finalYear =
          overrideYear !== undefined
            ? overrideYear
            : step2SpreadsheetSource === "current"
              ? statementYear ?? inferredYearFromRows
              : inferredYearFromRows;

        if (letterFormat === "word") {
          const blob = await getThankYouLetterWordBlob(donorName, donations, finalYear);
          zip.file(getThankYouLetterWordFileName(donorName), blob);
        } else {
          const blob = await getThankYouLetterBlob(donorName, donations, finalYear);
          zip.file(getThankYouLetterFileName(donorName), blob);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = "AAPASD_letters_from_template.zip";
      link.click();
      URL.revokeObjectURL(zipUrl);
    } catch (step2Error) {
      const message =
        step2Error instanceof Error
          ? step2Error.message
          : "Step 2 failed while generating donor letters.";
      setError(message);
    }
  }

  function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordInput === APP_PASSWORD) {
      setIsUnlocked(true);
      setPasswordError(null);
      return;
    }
    setPasswordError("Incorrect password.");
  }

  return (
    <main className="page-shell">
      {!isUnlocked ? (
        <section className="card" style={{ maxWidth: "520px", margin: "3rem auto" }}>
          <h1 className="card-title">AAPASD Donor Portal</h1>
          <p className="muted-text">Enter password to use this page.</p>
          <form className="stack-sm" onSubmit={handleUnlock}>
            <label className="input-label" htmlFor="portal-password">
              Password
            </label>
            <input
              id="portal-password"
              className="file-input"
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.currentTarget.value)}
              autoFocus
            />
            <button type="submit" className="cta-btn">
              Unlock
            </button>
            {passwordError ? <p className="error-text">{passwordError}</p> : null}
          </form>
        </section>
      ) : null}

      {isUnlocked ? (
      <>
      <section className="hero-panel">
        <p className="hero-kicker">AAPASD Finance Workflow</p>
        <h1 className="hero-title">Donation statements to donor-ready letters</h1>
        <p className="hero-copy">
          Upload monthly statement PDFs, extract donation records, store them in
          Convex, and generate a thank-you letter for each donor in one screen.
        </p>
      </section>

      <section className="dashboard-grid">
        <article className="card">
          <h2 className="card-title">Step 1: Statements -&gt; Spreadsheet</h2>
          <form onSubmit={handleUpload} className="stack-sm">
            <label className="input-label" htmlFor="pdf-upload">
              Statement files
            </label>
            <input
              id="pdf-upload"
              type="file"
              multiple
              accept="application/pdf"
              onChange={(event) =>
                setFiles(Array.from(event.currentTarget.files ?? []))
              }
              className="file-input"
            />
            <button disabled={isUploading} type="submit" className="cta-btn">
              {isUploading ? "Extracting..." : "Extract + Save to Convex"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={!activeBatch || activeBatch.donations.length === 0}
              onClick={handleDownloadSpreadsheet}
            >
              Download Contributions Spreadsheet (CSV)
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
            {error ? <p className="error-text">{error}</p> : null}
          </form>
        </article>

        <article className="card">
          <h2 className="card-title">Saved Extraction Batches</h2>
          <div className="stack-sm">
            <label className="input-label" htmlFor="batch-select">
              Batch history
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
                } else {
                  setActiveBatch(null);
                }
              }}
            >
              <option value="">Select a saved batch</option>
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
              <p className="muted-text">No batches yet. Upload PDFs to begin.</p>
            )}
          </div>
        </article>
      </section>

      <section className="records-panel">
        <div className="panel-header">
          <h2 className="card-title">Contributions Spreadsheet Preview</h2>
          <span className="pill">
            {donationsViewMode === "individual"
              ? `${sortedIndividualDonations.length} rows`
              : `${sortedTotalRows.length} donors`}
          </span>
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
                </tr>
              </thead>
              <tbody>
                {groupIndividualByPerson
                  ? groupedIndividualDonations.flatMap(([donorName, rows]) => [
                      <tr key={`group-${donorName}`} className="group-row">
                        <td colSpan={5}>
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
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="records-panel">
        <div className="panel-header">
          <h2 className="card-title">Step 2: Spreadsheet -&gt; Letters</h2>
        </div>
        <form onSubmit={handleStep2} className="stack-sm">
          <label className="input-label" htmlFor="step2-spreadsheet-source">
            Spreadsheet source
          </label>
          <select
            id="step2-spreadsheet-source"
            className="select-input"
            value={step2SpreadsheetSource}
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
            onChange={(event) =>
              setStep2Spreadsheet(event.currentTarget.files?.[0] ?? null)
            }
          />
            </>
          ) : null}

          <label className="input-label" htmlFor="step2-year-override">
            Donation year override (optional)
          </label>
          <input
            id="step2-year-override"
            className="file-input"
            type="number"
            min={2000}
            max={2099}
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
        </form>
      </section>

      <section className="records-panel">
        <div className="panel-header">
          <h2 className="card-title">Generate letters by donor</h2>
          <div className="panel-actions">
            <span className="pill">{groupedByDonor.length} donors</span>
            <button
              type="button"
              className="secondary-btn"
              disabled={groupedByDonor.length === 0 || isDownloadingAll}
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

            return (
              <article key={donorName} className="donor-card">
                <h3>{donorName}</h3>
                <p>
                  {donations.length} donation(s) - ${total.toFixed(2)} total
                </p>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    letterFormat === "word"
                      ? downloadThankYouLetterWord(
                          donorName,
                          donations,
                          effectiveLetterYear,
                        )
                      : downloadThankYouLetter(
                          donorName,
                          donations,
                          effectiveLetterYear,
                        )
                  }
                >
                  {letterFormat === "word"
                    ? "Download letter Word"
                    : "Download letter PDF"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
      </>
      ) : null}
    </main>
  );
}
