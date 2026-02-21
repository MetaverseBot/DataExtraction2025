import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: batchRow, error: batchError } = await supabase
      .from("donation_batches")
      .select("id, created_at, total_records, file_names")
      .eq("id", id)
      .maybeSingle();

    if (batchError) {
      throw new Error(batchError.message);
    }

    if (!batchRow) {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }

    const { data: donationRows, error: donationError } = await supabase
      .from("donations")
      .select("name, date, amount, payment_type, email, source_file_name")
      .eq("batch_id", id);

    if (donationError) {
      throw new Error(donationError.message);
    }

    return NextResponse.json({
      batch: {
        _id: batchRow.id,
        createdAt: new Date(batchRow.created_at).getTime(),
        totalRecords: batchRow.total_records,
        fileNames: batchRow.file_names,
      },
      donations: (donationRows ?? []).map((row) => ({
        name: row.name,
        date: row.date,
        amount: row.amount,
        paymentType: row.payment_type,
        email: row.email,
        sourceFileName: row.source_file_name ?? undefined,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
