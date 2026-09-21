import { NextResponse } from "next/server";

import { getSession, SESSION_COOKIE, setExeDeviceCookie, verifySessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXE_PRODUCT, keyExpiryIsAfter } from "@/lib/exe-license";

export const dynamic = "force-dynamic";

// GET /api/exe-license/enter — the ONLY place the exe-device cookie is set
// from the workspace-handoff path (2026-09-19). app/workspace/page.tsx
// redirects here (with the exact same query string) whenever it can't
// already tell the current session is the bound device — Next.js only
// allows setting cookies from a Route Handler or Server Action, never
// during a page's own render, so the write has to happen here rather than
// in the page itself. Re-verifies (defense in depth: the page already
// checked once, but nothing here trusts that) that the caller is logged in
// and deviceId genuinely names their currently-bound device before writing
// anything, then bounces straight back to /workspace with the same query
// string workspace-handoff.tsx and the rest of the flow still expect.
//
// Task 69, scope 1 — also the landing hop for the EXE first-launch account
// screen: the local runtime cannot plant a HOSTED session cookie itself (a
// Set-Cookie from http://127.0.0.1 for the hosted origin would be
// third-party and dropped), so it forwards the fresh JWT as ?sessionToken=
// instead. When present, the token is verified exactly like the normal
// session cookie (verifySessionToken — same issuer/audience/secret, never a
// looser check) and planted as the real SESSION_COOKIE before redirecting,
// so the user lands logged IN rather than at a login wall. The token rides
// a same-machine hop only — local runtime to hosted app — and is consumed
// immediately here, never stored.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId")?.trim();
  const sessionToken = url.searchParams.get("sessionToken")?.trim();

  // The redirect target: /workspace by default (the existing handoff flow),
  // or the ?next= path when the EXE first-launch flow needs to land on
  // /verify for a brand-new account. Restricted to same-origin relative
  // paths so this hop can never become an open redirect.
  const next = url.searchParams.get("next")?.trim() ?? "";
  const dest =
    next.startsWith("/") && !next.startsWith("//") ? new URL(next, url.origin) : new URL("/workspace", url.origin);

  // Preserve the handoff query the rest of the flow expects (deviceId,
  // deviceLabel, source, ...) on the redirect — minus sessionToken and next
  // themselves, which are consumed here and must not linger in the address
  // bar. NOTE: dest.search is set from forward ONLY on the default path —
  // when ?next= carries its own query (e.g. /verify?email=...), dest already
  // holds it and must NOT be overwritten (a past revision set dest.search
  // from forward unconditionally here, which nested the email INSIDE ?next=
  // as an encoded blob and the verify page showed a blank inbox).
  const forward = new URLSearchParams(url.searchParams);
  forward.delete("sessionToken");
  forward.delete("next");
  if (!next.startsWith("/") || next.startsWith("//")) {
    dest.search = forward.toString();
  }

  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken);
    if (payload) {
      const res = NextResponse.redirect(dest);
      res.cookies.set(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days — mirrors lib/auth.ts SESSION_MAX_AGE
      });
      return res;
    }
    // Invalid/expired token — fall through to the normal session check
    // below, which lands an unauthenticated caller on the login wall.
  }

  if (deviceId) {
    const session = await getSession();
    if (session) {
      const rows = await db.exeLicense.findMany({ where: { userId: session.sub, product: EXE_PRODUCT } });
      const now = new Date();
      const isBoundHere = rows.some(
        (l) =>
          l.boundMachineId?.trim().toLowerCase() === deviceId.toLowerCase() &&
          keyExpiryIsAfter(l.licenseKey, now),
      );
      if (isBoundHere) {
        await setExeDeviceCookie(deviceId);
      }
    }
  }

  const fallback = new URL("/workspace", url.origin);
  fallback.search = forward.toString();
  return NextResponse.redirect(fallback);
}
