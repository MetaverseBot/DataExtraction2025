import { jsPDF } from "jspdf";
import { DonationRecord } from "@/lib/types";

let cachedLogoDataUrl: string | null = null;

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

export async function downloadThankYouLetter(
  name: string,
  donations: DonationRecord[],
  statementYear?: number,
) {
  const blob = await getThankYouLetterBlob(name, donations, statementYear);
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

export async function getThankYouLetterBlob(
  name: string,
  donations: DonationRecord[],
  statementYear?: number,
): Promise<Blob> {
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
  const body = [
    `Dear ${name},`,
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
  const currentYear = statementYear ?? new Date().getFullYear();

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
