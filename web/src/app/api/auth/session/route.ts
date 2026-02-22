import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { APP_AUTH_COOKIE, getSessionSignature } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(APP_AUTH_COOKIE)?.value;
  const isAuthenticated = cookieValue === getSessionSignature();

  return NextResponse.json({ authenticated: isAuthenticated });
}
