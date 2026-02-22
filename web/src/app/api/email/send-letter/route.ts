import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

type SendLetterPayload = {
  to: string;
  subject: string;
  bodyText: string;
  attachmentBase64: string;
  attachmentFileName: string;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getMailerConfig() {
  const user = process.env.GMAIL_USER?.trim();
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();

  if (!user || !clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail OAuth env vars. Required: GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.",
    );
  }

  return { user, clientId, clientSecret, refreshToken };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SendLetterPayload;

    if (!payload.to || !isValidEmail(payload.to)) {
      return NextResponse.json({ error: "Invalid recipient email." }, { status: 400 });
    }

    if (!payload.attachmentBase64 || !payload.attachmentFileName) {
      return NextResponse.json({ error: "Missing attachment payload." }, { status: 400 });
    }

    const { user, clientId, clientSecret, refreshToken } = getMailerConfig();
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user,
        clientId,
        clientSecret,
        refreshToken,
      },
    });

    await transporter.sendMail({
      from: user,
      to: payload.to,
      subject: payload.subject,
      text: payload.bodyText,
      attachments: [
        {
          filename: payload.attachmentFileName,
          content: Buffer.from(payload.attachmentBase64, "base64"),
        },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
