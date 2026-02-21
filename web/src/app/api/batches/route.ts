import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("donation_batches")
      .select("id, created_at, total_records, file_names")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      throw new Error(error.message);
    }

    const batches = (data ?? []).map((row) => ({
      _id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      totalRecords: row.total_records,
      fileNames: row.file_names,
    }));

    return NextResponse.json({ batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
