import { jsPDF } from "jspdf";
import { DonationRecord } from "@/lib/types";

type LetterOptions = {
  statementYear?: number;
  templateText?: string;
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
  const totalAmount = donations.reduce((sum, row) => {
    const value = Number(row.amount.replaceAll("$", "").replaceAll(",", ""));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const body = buildLetterBody(
    name,
    options.templateText,
    donations.length,
    totalAmount,
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
  const currentYear = options.statementYear ?? new Date().getFullYear();

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

    const rowDate = donation.date.includes("/")
      ? `${donation.date}/${currentYear}`
      : donation.date;

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

export async function getThankYouLetterWordBlob(
  name: string,
  donations: DonationRecord[],
  statementYear?: number,
): Promise<Blob> {
  const logoDataUrl = await getWordLogoDataUrl();
  const year = statementYear ?? new Date().getFullYear();
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const rowsHtml = donations
    .map((donation) => {
      const rowDate = donation.date.includes("/")
        ? `${donation.date}/${year}`
        : donation.date;
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
    <p>Dear ${escapeHtml(name)},</p>

    <p>On behalf of the Asian American Parent Alliance of San Diego (AAPASD), we would like to thank you very much for your support to AAPASD. Your care for the education of the youths will certainly have a great positive impact on their lives and on the future of our community.</p>

    <p>Fostering Asian American community participation and providing a platform to advocate for-merit-based education in San Diego County are the missions we are devoted to. Without your continuing support, we can never achieve these noble goals. Your support is the foundation of our organization.</p>

    <p>If you have any questions about your donation or suggestion about how to improve this organization, please contact us based on the information provided above. If you wish to work with us as a volunteer, also kindly let us know.</p>

    <p>Thank you again for your confidence and generosity!</p>
    <p>Sincerely,</p>
    <p>Team AAPASD<br/><a class="link" href="mailto:Accounting@AAPASD.org">Accounting@AAPASD.org</a></p>

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

export async function downloadThankYouLetterWord(
  name: string,
  donations: DonationRecord[],
  statementYear?: number,
) {
  const blob = await getThankYouLetterWordBlob(name, donations, statementYear);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getThankYouLetterWordFileName(name);
  link.click();
  URL.revokeObjectURL(url);
}

function buildLetterBody(
  donorName: string,
  templateText: string | undefined,
  donationCount: number,
  totalAmount: number,
): string[] {
  if (templateText && templateText.trim().length > 0) {
    const filled = templateText
      .replaceAll("{{name}}", donorName)
      .replaceAll("{{donor_name}}", donorName)
      .replaceAll("{{donation_count}}", String(donationCount))
      .replaceAll("{{total_amount}}", `$${totalAmount.toFixed(2)}`)
      .replaceAll("{{organization}}", "Asian American Parent Alliance of San Diego");

    return filled.split(/\r?\n/);
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
