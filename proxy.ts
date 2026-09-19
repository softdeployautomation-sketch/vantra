import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware` to `proxy` (the `middleware.ts` convention is
// deprecated). This file provides the same auth-gate behavior from the plan's
// `middleware.ts`: gate /dashboard/** behind a valid CUSTOMER session cookie,
// and /admin101/** behind a valid ADMIN session cookie (defense-in-depth — the
// admin API routes and protected layout gate themselves with jose/cookies too).
// The admin path is deliberately not the guessable "/admin" — the passcode
// gate is the real security boundary, but an unguessable path also keeps it
// off automated /admin scanners.
//
// Both sessions are verified here with `jose` (Edge-safe, no native bcrypt).
// They use distinct cookie names + issuer/audience, so they're never
// interchangeable.

const CUSTOMER_COOKIE = "vantra_session";
const CUSTOMER_ISSUER = "vantra";
const CUSTOMER_AUDIENCE = "vantra";

const ADMIN_COOKIE = "vantra_admin_session";
const ADMIN_ISSUER = "vantra-admin";
const ADMIN_AUDIENCE = "vantra-admin";

const encoder = new TextEncoder();
const secret = () => encoder.encode(process.env.SESSION_SECRET ?? "");

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = pathname.startsWith("/admin101");
  // The admin login page is public (no session yet) — let it render like the
  // customer /login page (which isn't in the matcher either).
  if (isAdmin && pathname === "/admin101/login") {
    return NextResponse.next();
  }

  const cookieName = isAdmin ? ADMIN_COOKIE : CUSTOMER_COOKIE;
  const issuer = isAdmin ? ADMIN_ISSUER : CUSTOMER_ISSUER;
  const audience = isAdmin ? ADMIN_AUDIENCE : CUSTOMER_AUDIENCE;
  const loginPath = isAdmin ? "/admin101/login" : "/login";

  const token = request.cookies.get(cookieName)?.value;
  if (!token) {
    return redirectTo(request, loginPath);
  }

  try {
    await jwtVerify(token, secret(), { issuer, audience });
    // Confirmed live (2026-09-19) — the desktop-mode web gate in
    // app/dashboard/layout.tsx needs to know which route is being requested
    // (Settings stays reachable — billing + the EXE license card live there
    // — everything else under /dashboard gets replaced with the gate). A
    // Server Component layout has no other reliable way to read the current
    // pathname, so proxy.ts forwards it as a request header here.
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  } catch {
    return redirectTo(request, loginPath);
  }
}

function redirectTo(request: NextRequest, path: string) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding", "/admin101/:path*"],
};