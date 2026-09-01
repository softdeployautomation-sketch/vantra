import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware` to `proxy` (the `middleware.ts` convention is
// deprecated). This file provides the same auth-gate behavior from the plan's
// `middleware.ts`: gate /dashboard/** behind a valid session cookie.
//
// The session JWT is verified here with `jose` (Edge-safe, no native bcrypt),
// which is why sessions are signed with jose rather than anything Node-only.

const SESSION_COOKIE = "vantra_session";
const SESSION_ISSUER = "vantra";
const SESSION_AUDIENCE = "vantra";

const encoder = new TextEncoder();
const secret = () => encoder.encode(process.env.SESSION_SECRET ?? "");

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  try {
    await jwtVerify(token, secret(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    // Valid session — allow the request through.
    return NextResponse.next();
  } catch {
    return redirectToLogin(request);
  }
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};