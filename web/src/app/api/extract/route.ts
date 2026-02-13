import { ConvexHttpClient } from "convex/browser";
import { createRequire } from "node:module";
import { NextResponse } from "next/server";
import { extractDonationsFromText } from "@/lib/extraction";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  dataBuffer: Buffer,
) => Promise<{ text: string }>;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set.");
  }
  return new ConvexHttpClient(convexUrl) as unknown as {
    mutation: (name: string, args: unknown) => Promise<string>;
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files were uploaded." },
        { status: 400 },
      );
    }

    let fullText = "";
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await pdfParse(buffer);
      fullText += `${parsed.text}\n`;
    }

    const { records, invalidLines } = extractDonationsFromText(fullText);
    if (records.length === 0) {
      return NextResponse.json(
        {
          error: "No payment entries matched the parser.",
          invalidLines,
        },
        { status: 422 },
      );
    }

    const convex = getConvexClient();
    const batchId = await convex.mutation("donations:saveBatch", {
      fileNames: files.map((file) => file.name),
      records,
    });

    return NextResponse.json({ batchId, count: records.length, invalidLines });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
