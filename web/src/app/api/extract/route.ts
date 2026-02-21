import { createRequire } from "node:module";
import { NextResponse } from "next/server";
import { extractDonationsFromText } from "@/lib/extraction";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { DonationRecord } from "@/lib/types";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  dataBuffer: Buffer,
) => Promise<{ text: string }>;

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

    const records: DonationRecord[] = [];
    let invalidLines = 0;
    const invalidExamples: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await pdfParse(buffer);
      const extracted = extractDonationsFromText(parsed.text, file.name);
      records.push(...extracted.records);
      invalidLines += extracted.invalidLines;
      for (const line of extracted.invalidExamples) {
        if (invalidExamples.length < 15) {
          invalidExamples.push(`${file.name}: ${line}`);
        }
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        {
          error: "No payment entries matched the parser.",
          invalidLines,
          invalidExamples,
        },
        { status: 422 },
      );
    }

    const supabase = getSupabaseAdmin();
    const now = new Date();

    const { data: batch, error: batchError } = await supabase
      .from("donation_batches")
      .insert({
        created_at: now.toISOString(),
        file_names: files.map((file) => file.name),
        total_records: records.length,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      throw new Error(batchError?.message ?? "Failed to create extraction batch.");
    }

    const donationRows = records.map((record) => ({
      batch_id: batch.id,
      name: record.name,
      date: record.date,
      amount: record.amount,
      payment_type: record.paymentType,
      email: record.email,
      source_file_name: record.sourceFileName ?? null,
    }));

    const { error: donationInsertError } = await supabase
      .from("donations")
      .insert(donationRows);

    if (donationInsertError) {
      throw new Error(donationInsertError.message);
    }

    return NextResponse.json({
      batchId: batch.id,
      count: records.length,
      invalidLines,
      invalidExamples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
