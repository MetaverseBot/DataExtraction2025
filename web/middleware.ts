import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { APP_AUTH_COOKIE, getSessionSignature } from "./src/lib/auth";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login") {
    return true;
  }

  if (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/session"
  ) {
    return true;
  }

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return true;
  }

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(APP_AUTH_COOKIE)?.value;
  const isAuthenticated = cookieValue === getSessionSignature();
  if (isAuthenticated) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
