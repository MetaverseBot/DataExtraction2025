import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set.");
  }

  return new ConvexHttpClient(convexUrl) as unknown as {
    query: (name: string, args: unknown) => Promise<unknown>;
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const convex = getConvexClient();
    const result = await convex.query("donations:getBatchById", { batchId: id });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
