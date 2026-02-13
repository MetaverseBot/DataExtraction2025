"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import {
  downloadThankYouLetter,
  getThankYouLetterBlob,
  getThankYouLetterFileName,
} from "@/lib/letterPdf";
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

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [activeBatch, setActiveBatch] = useState<BatchDetail | null>(null);
  const [invalidLines, setInvalidLines] = useState<number>(0);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

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

  const statementYear = useMemo(() => {
    if (!activeBatch) {
      return undefined;
    }
    return inferStatementYear(activeBatch.batch.fileNames);
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

    if (data.batches.length > 0 && !selectedBatchId) {
      setSelectedBatchId(data.batches[0]._id);
      await loadBatchDetails(data.batches[0]._id);
    }
  }, [loadBatchDetails, selectedBatchId]);

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

  async function handleDownloadAllLetters() {
    if (groupedByDonor.length === 0) {
      return;
    }

    setError(null);
    setIsDownloadingAll(true);

    try {
      const zip = new JSZip();

      for (const [donorName, donations] of groupedByDonor) {
        const blob = await getThankYouLetterBlob(
          donorName,
          donations,
          statementYear,
        );
        zip.file(getThankYouLetterFileName(donorName), blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = `AAPASD_Thank_You_Letters_${selectedBatchId || "batch"}.zip`;
      link.click();
      URL.revokeObjectURL(zipUrl);
    } catch {
      setError("Failed to generate ZIP file for all letters.");
    } finally {
      setIsDownloadingAll(false);
    }
  }

  return (
    <main className="page-shell">
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
          <h2 className="card-title">1) Upload statement PDFs</h2>
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
          <h2 className="card-title">2) Review stored batches</h2>
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
                await loadBatchDetails(batchId);
              }}
            >
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
          <h2 className="card-title">Extracted records</h2>
          <span className="pill">{activeBatch?.donations.length ?? 0} rows</span>
        </div>

        <div className="table-wrap">
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
              {activeBatch?.donations.map((record, index) => (
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
        </div>
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
                    downloadThankYouLetter(donorName, donations, statementYear)
                  }
                >
                  Download letter PDF
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
