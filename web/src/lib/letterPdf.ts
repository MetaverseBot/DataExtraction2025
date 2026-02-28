import { jsPDF } from "jspdf";
import { DonationRecord } from "@/lib/types";
import { CampPaymentRow } from "@/lib/spreadsheet";

type LetterOptions = {
  statementYear?: number;
  templateText?: string;
  templateReplacements?: Record<string, string>;
};

let cachedLogoDataUrl: string | null = null;
let cachedWordLogoDataUrl: string | null = null;

async function getLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl) {
    return cachedLogoDataUrl;
  }

  try {
    const response = await fetch("/aapasd-logo.jpg");
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    cachedLogoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not load logo image"));
      reader.readAsDataURL(blob);
    });

    return cachedLogoDataUrl;
  } catch {
    return null;
  }
}

async function getWordLogoDataUrl(): Promise<string | null> {
  if (cachedWordLogoDataUrl) {
    return cachedWordLogoDataUrl;
  }

  const sourceDataUrl = await getLogoDataUrl();
  if (!sourceDataUrl) {
    return null;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode logo image"));
      image.src = sourceDataUrl;
    });

    const targetSize = 90;
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return sourceDataUrl;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetSize, targetSize);

    const ratio = Math.min(targetSize / img.width, targetSize / img.height);
    const drawWidth = img.width * ratio;
    const drawHeight = img.height * ratio;
    const offsetX = (targetSize - drawWidth) / 2;
    const offsetY = (targetSize - drawHeight) / 2;

    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    cachedWordLogoDataUrl = canvas.toDataURL("image/png");
    return cachedWordLogoDataUrl;
  } catch {
    return sourceDataUrl;
  }
}

export async function downloadThankYouLetter(
  name: string,
  donations: DonationRecord[],
  statementYearOrOptions?: number | LetterOptions,
) {
  const blob = await getThankYouLetterBlob(
    name,
    donations,
    statementYearOrOptions,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getThankYouLetterFileName(name);
  link.click();
  URL.revokeObjectURL(url);
}

export function getThankYouLetterFileName(name: string): string {
  const safeName = name.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return `Thank_You_Letter_${safeName}.pdf`;
}

export function getThankYouLetterWordFileName(name: string): string {
  const safeName = name.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return `Thank_You_Letter_${safeName}.doc`;
}

export async function getThankYouLetterBlob(
  name: string,
  donations: DonationRecord[],
  statementYearOrOptions?: number | LetterOptions,
): Promise<Blob> {
  const options: LetterOptions =
    typeof statementYearOrOptions === "number"
      ? { statementYear: statementYearOrOptions }
      : statementYearOrOptions ?? {};

  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = 612;
  const marginLeft = 36;
  const contentWidth = pageWidth - marginLeft * 2;

  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const paymentLabel = (paymentType: string) => {
    if (!paymentType) {
      return "N/A";
    }
    if (paymentType.toLowerCase().includes("payment")) {
      return paymentType;
    }
    return `${paymentType} Payment`;
  };

  const totalAmount = donations.reduce((sum, row) => {
    const value = Number(row.amount.replaceAll("$", "").replaceAll(",", ""));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const currentYear = options.statementYear ?? new Date().getFullYear();
  const firstDonation = donations[0];
  const firstDate = firstDonation
    ? normalizeContributionDate(firstDonation.date, currentYear)
    : "";
  const firstPaymentType = firstDonation ? paymentLabel(firstDonation.paymentType) : "";

  if (options.templateText && options.templateText.trim().length > 0) {
    const body = buildLetterBody(name, options.templateText, donations.length, totalAmount, {
      today,
      firstDate,
      firstPaymentType,
      templateReplacements: options.templateReplacements,
    });

    let y = 50;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    for (const line of body) {
      const wrapped = pdf.splitTextToSize(line, contentWidth);
      if (y + wrapped.length * 17 > 760) {
        pdf.addPage("letter", "portrait");
        y = 50;
      }
      pdf.text(wrapped, marginLeft, y);
      y += wrapped.length * 17 + 4;
    }

    return pdf.output("blob");
  }

  let y = 42;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(21);
  pdf.text("Asian American Parent Alliance of San Diego", marginLeft, y);

  const logoDataUrl = await getLogoDataUrl();
  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, "JPEG", 485, 24, 90, 90);
  }

  y += 30;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(13);
  pdf.text("4653 Carmel Mountain Rd, # 308-220", marginLeft, y);
  y += 19;
  pdf.text("San Diego, CA 92130", marginLeft, y);
  y += 19;
  pdf.setTextColor(30, 90, 210);
  const headerLink = "www.AAPASD.org Email: info@AAPASD.org";
  pdf.text(headerLink, marginLeft, y);
  const headerLinkWidth = pdf.getTextWidth(headerLink);
  pdf.line(marginLeft, y + 2, marginLeft + headerLinkWidth, y + 2);

  y += 28;
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(16);
  pdf.text(today, marginLeft, y);

  y += 30;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  const body = buildLetterBody(
    name,
    options.templateText,
    donations.length,
    totalAmount,
    {
      today,
      firstDate,
      firstPaymentType,
      templateReplacements: options.templateReplacements,
    },
  );

  for (const line of body) {
    const wrapped = pdf.splitTextToSize(line, contentWidth);
    pdf.text(wrapped, marginLeft, y);
    y += wrapped.length * 17 + 4;
  }

  pdf.setTextColor(30, 90, 210);
  pdf.text("Accounting@AAPASD.org", marginLeft, y);
  const accountingWidth = pdf.getTextWidth("Accounting@AAPASD.org");
  pdf.line(marginLeft, y + 2, marginLeft + accountingWidth, y + 2);
  pdf.setTextColor(0, 0, 0);
  y += 20;

  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);

  const colX = [36, 158, 306, 462, 612 - 36];
  const rowHeight = 24;
  const tableTop = y;

  const tableTotalHeight = rowHeight * (donations.length + 1);
  if (tableTop + tableTotalHeight + 46 > 792) {
    pdf.addPage("letter", "portrait");
    y = 42;
  }

  const startY = y;
  pdf.rect(colX[0], startY, colX[4] - colX[0], rowHeight);
  for (let i = 1; i < colX.length - 1; i += 1) {
    pdf.line(colX[i], startY, colX[i], startY + rowHeight);
  }
  pdf.text("Contribution Date", colX[0] + 4, startY + 16);
  pdf.text("Amount", colX[1] + 4, startY + 16);
  pdf.text("Sponsor(s)", colX[2] + 4, startY + 16);
  pdf.text("Payment Type", colX[3] + 4, startY + 16);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  let rowY = startY + rowHeight;
  for (const donation of donations) {
    if (rowY + rowHeight > 760) {
      pdf.addPage("letter", "portrait");
      rowY = 50;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.rect(colX[0], rowY, colX[4] - colX[0], rowHeight);
      for (let i = 1; i < colX.length - 1; i += 1) {
        pdf.line(colX[i], rowY, colX[i], rowY + rowHeight);
      }
      pdf.text("Contribution Date", colX[0] + 4, rowY + 16);
      pdf.text("Amount", colX[1] + 4, rowY + 16);
      pdf.text("Sponsor(s)", colX[2] + 4, rowY + 16);
      pdf.text("Payment Type", colX[3] + 4, rowY + 16);

      rowY += rowHeight;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
    }

    const rowDate = normalizeContributionDate(donation.date, currentYear);

    pdf.rect(colX[0], rowY, colX[4] - colX[0], rowHeight);
    for (let i = 1; i < colX.length - 1; i += 1) {
      pdf.line(colX[i], rowY, colX[i], rowY + rowHeight);
    }

    pdf.text(rowDate, colX[0] + 4, rowY + 16);
    pdf.text(donation.amount, colX[1] + 4, rowY + 16);
    pdf.text(donation.name, colX[2] + 4, rowY + 16);
    pdf.text(paymentLabel(donation.paymentType), colX[3] + 4, rowY + 16);

    rowY += rowHeight;
  }

  const footerY = Math.min(rowY + 16, 772);
  pdf.setFontSize(9);
  pdf.text(
    "Contributions to AAPASD, a non-profit 501(c)(3) charitable organization, are tax deductible",
    36,
    footerY,
  );
  pdf.text(
    "to the extent provided by law. Please retain this letter as receipt of your donation.",
    36,
    footerY + 11,
  );
  pdf.text("Our Tax ID Number is 88-2564739.", 36, footerY + 22);

  return pdf.output("blob");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getThankYouLetterWordBlob(
  name: string,
  donations: DonationRecord[],
  statementYearOrOptions?: number | LetterOptions,
): Promise<Blob> {
  const options: LetterOptions =
    typeof statementYearOrOptions === "number"
      ? { statementYear: statementYearOrOptions }
      : statementYearOrOptions ?? {};

  const logoDataUrl = await getWordLogoDataUrl();
  const year = options.statementYear ?? new Date().getFullYear();
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const totalAmount = donations.reduce((sum, row) => {
    const value = Number(row.amount.replaceAll("$", "").replaceAll(",", ""));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const firstDonation = donations[0];
  const firstDate = firstDonation
    ? normalizeContributionDate(firstDonation.date, year)
    : "";
  const firstPaymentType = firstDonation
    ? firstDonation.paymentType.toLowerCase().includes("payment")
      ? firstDonation.paymentType
      : `${firstDonation.paymentType} Payment`
    : "";

  const bodyLines = buildLetterBody(name, options.templateText, donations.length, totalAmount, {
    today,
    firstDate,
    firstPaymentType,
    templateReplacements: options.templateReplacements,
  });
  const bodyHtml = bodyLines
    .map((line) => {
      if (!line.trim()) {
        return "<p>&nbsp;</p>";
      }
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");

  const rowsHtml = donations
    .map((donation) => {
      const rowDate = normalizeContributionDate(donation.date, year);
      const labeledPaymentType = donation.paymentType.toLowerCase().includes("payment")
        ? donation.paymentType
        : `${donation.paymentType} Payment`;

      return `
        <tr>
          <td>${escapeHtml(rowDate)}</td>
          <td>${escapeHtml(donation.amount)}</td>
          <td>${escapeHtml(donation.name)}</td>
          <td>${escapeHtml(labeledPaymentType)}</td>
        </tr>`;
    })
    .join("\n");

  const html = `
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light only" />
    <style>
      @page { size: 8.5in 11in; margin: 0.5in; }
      html, body {
        background: #ffffff !important;
        color: #000000 !important;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12pt;
        line-height: 1.45;
      }
      .page {
        width: 7.5in;
        margin: 0 auto;
        background: #ffffff !important;
        color: #000000 !important;
      }
      p { margin: 0 0 12pt 0; }
      .header-table {
        border-collapse: collapse;
        width: 7.5in;
        table-layout: fixed;
        margin: 0 0 10pt 0;
      }
      .header-table td {
        border: 0;
        padding: 0;
        vertical-align: top;
      }
      .title {
        font-size: 21pt;
        line-height: 1.2;
        white-space: nowrap;
      }
      .header-line { font-size: 13pt; line-height: 1.35; }
      .date-line { font-size: 16pt; margin: 14pt 0 16pt 0; }
      .link { color: #1e5ad2 !important; text-decoration: underline; }
      .data-table {
        border-collapse: collapse;
        width: 100%;
        margin-top: 14pt;
      }
      .data-table th, .data-table td {
        border: 1px solid #444;
        padding: 6px;
        text-align: left;
      }
      .data-table th { font-weight: 700; }
      .foot { margin-top: 12pt; font-size: 9pt; line-height: 1.25; }
    </style>
  </head>
  <body>
    <div class="page">
    <table class="header-table">
      <tr>
        <td style="width: 6.2in;">
          <div class="top">
            <div class="title">Asian American Parent Alliance of San Diego</div>
            <div class="header-line">4653 Carmel Mountain Rd, # 308-220</div>
            <div class="header-line">San Diego, CA 92130</div>
            <div class="header-line">
              <a class="link" href="https://www.aapasd.org">www.AAPASD.org</a>
              <span> Email: </span>
              <a class="link" href="mailto:info@AAPASD.org">info@AAPASD.org</a>
            </div>
          </div>
        </td>
        <td style="width: 1.1in; text-align: right;">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="AAPASD Logo" width="90" height="90" style="display: block;" />` : ""}
        </td>
      </tr>
    </table>

    <div class="date-line">${escapeHtml(today)}</div>
    ${bodyHtml}
    <p><a class="link" href="mailto:Accounting@AAPASD.org">Accounting@AAPASD.org</a></p>

    <table class="data-table">
      <thead>
        <tr>
          <th>Contribution Date</th>
          <th>Amount</th>
          <th>Sponsor(s)</th>
          <th>Payment Type</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="foot">Contributions to AAPASD, a non-profit 501(c)(3) charitable organization, are tax deductible to the extent provided by law. Please retain this letter as receipt of your donation. Our Tax ID Number is 88-2564739.</div>
    </div>
  </body>
</html>`;

  return new Blob([html], { type: "application/msword" });
}

function normalizeContributionDate(dateValue: string, fallbackYear: number): string {
  const normalized = dateValue.trim();
  if (/20\d{2}/.test(normalized)) {
    return normalized;
  }

  if (/^\d{2}\/\d{2}$/.test(normalized)) {
    return `${normalized}/${fallbackYear}`;
  }

  return normalized;
}

export async function downloadThankYouLetterWord(
  name: string,
  donations: DonationRecord[],
  statementYearOrOptions?: number | LetterOptions,
) {
  const blob = await getThankYouLetterWordBlob(name, donations, statementYearOrOptions);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getThankYouLetterWordFileName(name);
  link.click();
  URL.revokeObjectURL(url);
}

export async function getCampReceiptLetterBlob(
  parentName: string,
  payments: CampPaymentRow[],
  templateText?: string,
): Promise<Blob> {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const marginLeft = 36;
  const contentWidth = 540;
  let y = 42;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(21);
  pdf.text("Asian American Parent Alliance of San Diego", marginLeft, y);

  const logoDataUrl = await getLogoDataUrl();
  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, "JPEG", 485, 24, 90, 90);
  }

  y += 30;
  pdf.setFontSize(13);
  pdf.text("4653 Carmel Mountain Rd, # 308-220", marginLeft, y);
  y += 19;
  pdf.text("San Diego, CA 92130", marginLeft, y);
  y += 19;
  pdf.setTextColor(30, 90, 210);
  pdf.text("www.AAPASD.org Email: info@AAPASD.org", marginLeft, y);
  y += 28;

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(16);
  pdf.text(
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    marginLeft,
    y,
  );

  y += 30;
  pdf.setFontSize(12);
  const body = buildCampBody(parentName, payments, templateText);

  for (const line of body) {
    if (!line.trim()) {
      y += 6;
      continue;
    }

    const wrapped = pdf.splitTextToSize(line, contentWidth);
    pdf.text(wrapped, marginLeft, y);
    y += wrapped.length * 13 + 2;
  }

  pdf.setTextColor(30, 90, 210);
  pdf.text("Accounting@AAPASD.org", marginLeft, y);
  pdf.setTextColor(0, 0, 0);
  y += 18;

  const headers = ["Payment Date", "Camp Dates", "Amount", "Paid By", "Camper Name"];
  const colX = [36, 120, 252, 332, 448, 576];
  const rowH = 24;

  const requiredTableHeight = rowH * (payments.length + 1) + 40;
  if (y + requiredTableHeight > 760) {
    pdf.addPage("letter", "portrait");
    y = 50;
  }

  pdf.setFont("helvetica", "bold");
  pdf.rect(colX[0], y, colX[colX.length - 1] - colX[0], rowH);
  for (let i = 1; i < colX.length - 1; i += 1) {
    pdf.line(colX[i], y, colX[i], y + rowH);
  }
  headers.forEach((h, i) => pdf.text(h, colX[i] + 4, y + 16));

  pdf.setFont("helvetica", "normal");
  for (const row of payments) {
    y += rowH;
    pdf.rect(colX[0], y, colX[colX.length - 1] - colX[0], rowH);
    for (let i = 1; i < colX.length - 1; i += 1) {
      pdf.line(colX[i], y, colX[i], y + rowH);
    }
    const vals = [row.paymentDate, row.campDates, row.amount, row.paidBy, row.camperName];
    vals.forEach((v, i) => pdf.text(v || "", colX[i] + 4, y + 16));
  }

  y += 34;
  pdf.setFontSize(9);
  pdf.text(
    "Asian American Parent Alliance of San Diego (AAPASD) is a nonprofit 501(c)(3) organization.",
    36,
    y,
  );
  pdf.text("Tax ID: 88-2564739. Please retain this letter as receipt of your payment.", 36, y + 11);

  return pdf.output("blob");
}

function buildCampBody(
  parentName: string,
  payments: CampPaymentRow[],
  templateText?: string,
): string[] {
  if (templateText && templateText.trim()) {
    const today = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const first = payments[0];
    const totalAmount = payments.reduce((sum, row) => {
      const value = Number(row.amount.replaceAll("$", "").replaceAll(",", ""));
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);

    const normalizedTemplate = templateText
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n");

    const replaced = normalizedTemplate
      .replace(/\[\s*date\s*\]/gi, today)
      .replace(/\[\s*parent\s*[^\]]*guardian\s*name\s*\]/gi, parentName)
      .replace(/\[\s*parent\s*name\s*\]/gi, parentName)
      .replace(/\[\s*paid\s*date\s*\]/gi, first?.paymentDate ?? "")
      .replace(/\[\s*camp\s*dates\s*\]/gi, first?.campDates ?? "")
      .replace(/\[\s*camper\s*name\s*\]/gi, first?.camperName ?? "")
      .replace(/\$\s*\$/g, `$${totalAmount.toFixed(2)}`)
      .replace(/Dear\s*\[[^\]]+\]/gi, `Dear ${parentName},`)
      .replace(/\[[^\]]+\]/g, "");

    const filtered = replaced
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(
        (line) =>
          !/^\s*Asian\s+American\s+Parent\s+Alliance\s+of\s+San\s+Diego\s*$/i.test(line) &&
          !/^\s*4653\s+Carmel\s+Mountain\s+Rd.*$/i.test(line) &&
          !/^\s*San\s+Diego,\s*CA\s*92130\s*$/i.test(line) &&
          !/^\s*www\.AAPASD\.org\s*Email:\s*info@AAPASD\.org\s*$/i.test(line) &&
          !/^\s*[A-Za-z]+\s+\d{1,2},\s*20\d{2}\s*$/i.test(line) &&
          !/^\s*Payment\s*Date\s*$/i.test(line) &&
          !/^\s*Camp\s*Dates\s*$/i.test(line) &&
          !/^\s*Amount\s*$/i.test(line) &&
          !/^\s*Paid\s*By\s*$/i.test(line) &&
          !/^\s*Camper\s*Name\s*$/i.test(line) &&
          !/^\s*Asian\s+American\s+Parent\s+Alliance\s+of\s+San\s+Diego\s*\(AAPASD\).*/i.test(line) &&
          !/\[\s*Paid\s*Date\s*\]/i.test(line) &&
          !/\[\s*Camp\s*Dates\s*\]/i.test(line) &&
          !/\[\s*Camper\s*Name\s*\]/i.test(line),
      );

    return compactTemplateLines(filtered);
  }

  return compactTemplateLines([
    `Dear ${parentName},`,
    "",
    "Thank you for enrolling your child in our summer camp program. This letter serves as",
    "your official payment receipt for our summer camp as listed below.",
    "",
    "We are excited to provide a meaningful and enriching experience for our students",
    "through engaging educational and community-building activities.",
    "",
    "If you have any questions regarding your registration or payment, please feel free to",
    "contact us using the information above.",
    "",
    "Sincerely,",
    "",
    "Team AAPASD",
  ]);
}

function compactTemplateLines(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blankRun += 1;
      if (blankRun <= 1) {
        out.push("");
      }
      continue;
    }

    blankRun = 0;
    out.push(line);
  }

  while (out.length > 0 && !out[0].trim()) {
    out.shift();
  }
  while (out.length > 0 && !out[out.length - 1].trim()) {
    out.pop();
  }

  return out;
}

function buildLetterBody(
  donorName: string,
  templateText: string | undefined,
  donationCount: number,
  totalAmount: number,
  context?: {
    today?: string;
    firstDate?: string;
    firstPaymentType?: string;
    templateReplacements?: Record<string, string>;
  },
): string[] {
  if (templateText && templateText.trim().length > 0) {
    const today =
      context?.today ??
      new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    const firstDate = context?.firstDate ?? "";
    const firstPaymentType = context?.firstPaymentType ?? "";

    const filled = templateText
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\[\s*today['’]?s\s*date\s*\]/gi, today)
      .replace(/\[\s*date\s*\]/gi, today)
      .replace(/\[\s*parent\s*\/\s*guardian\s*name\s*\]/gi, donorName)
      .replace(/\[\s*parent\s*name\s*\]/gi, donorName)
      .replace(/\[\s*donor\s*name\s*\]/gi, donorName)
      .replace(/\[\s*payer\s*name\s*\]/gi, donorName)
      .replace(/\[\s*payor\s*name\s*\]/gi, donorName)
      .replace(/\[\s*name\s*\]/gi, donorName)
      .replace(/\[\s*payment\s*date\s*\]/gi, firstDate)
      .replace(/\[\s*contribution\s*date\s*\]/gi, firstDate)
      .replace(/\[\s*paid\s*date\s*\]/gi, firstDate)
      .replace(/\[\s*payment\s*type\s*\]/gi, firstPaymentType)
      .replace(/\[\s*donation\s*count\s*\]/gi, String(donationCount))
      .replace(/\[\s*total\s*amount\s*\]/gi, `$${totalAmount.toFixed(2)}`)
      .replace(/\$\s*\$/g, `$${totalAmount.toFixed(2)}`)
      .replaceAll("{{name}}", donorName)
      .replaceAll("{{donor_name}}", donorName)
      .replaceAll("{{donation_count}}", String(donationCount))
      .replaceAll("{{total_amount}}", `$${totalAmount.toFixed(2)}`)
      .replaceAll("{{organization}}", "Asian American Parent Alliance of San Diego");

    let withTemplateReplacements = filled;
    const templateReplacements = context?.templateReplacements ?? {};
    for (const [key, value] of Object.entries(templateReplacements)) {
      const pattern = new RegExp(`\\[\\s*${escapeRegex(key)}\\s*\\]`, "gi");
      withTemplateReplacements = withTemplateReplacements.replace(pattern, value ?? "");
    }

    return withTemplateReplacements.split(/\r?\n/);
  }

  return [
    `Dear ${donorName},`,
    "",
    "On behalf of the Asian American Parent Alliance of San Diego (AAPASD), we would like to thank",
    "you very much for your support to AAPASD. Your care for the education of the youths will",
    "certainly have a great positive impact on their lives and on the future of our community.",
    "",
    "Fostering Asian American community participation and providing a platform to advocate for-",
    "merit-based education in San Diego County are the missions we are devoted to. Without your",
    "continuing support, we can never achieve these noble goals. Your support is the foundation of",
    "our organization.",
    "",
    "If you have any questions about your donation or suggestion about how to improve this",
    "organization, please contact us based on the information provided above. If you wish to work",
    "with us as a volunteer, also kindly let us know.",
    "",
    "Thank you again for your confidence and generosity!",
    "",
    "Sincerely,",
    "",
    "",
    "Team AAPASD",
  ];
}
