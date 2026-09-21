import { NextResponse } from "next/server";

import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { saveTrialEmail } from "@/lib/license-state";

export const dynamic = "force-dynamic";

// Task 69, scope 1 — POST /api/exe-license/trial-start — body: { email, password }.
//
// LOCAL-runtime proxy for hosted POST /api/exe-trial/start. The local
// runtime (http://127.0.0.1) cannot call the hosted origin directly from the
// webview: the browser's same-origin policy blocks the cross-origin POST,
// and even if it went through, the hosted Set-Cookie would be a third-party
// cookie and dropped — the user would land on the hosted app logged OUT.
// Instead the EXE UI posts SAME-ORIGIN here; this route forwards server-side
// (no CORS, no cookie jar involved), caches the trial email locally so
// status can reconcile against the server authority, then returns the hosted
// payload PLUS the hosted session cookie value. The UI plants that cookie on
// the hosted origin (via the /api/exe-license/enter hop, the one place that
// writes hosted cookies) before redirecting, so the user lands logged IN.
//
// Rate limit: none of its own — the hosted /api/exe-trial/start behind it
// enforces "exe-trial-start" per-IP, and this route is unreachable anywhere
// except the local runtime (isLocalExeRuntime gate, fail-closed like
// status/activate).
export async function POST(req: Request) {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // Server-side forward to the hosted authority (same HOSTED_APP_URL the
  // activate route already uses — the one place the local runtime knows the
  // hosted origin). The hosted route does the real account + trial work.
  let hosted: Response;
  try {
    const { HOSTED_APP_URL } = await import("@/lib/exe-runtime");
    hosted = await fetch(`${HOSTED_APP_URL}/api/exe-trial/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach the account server — check your connection and try again." },
      { status: 502 },
    );
  }
  const data = await hosted.json().catch(() => ({}));
  if (!hosted.ok) {
    return NextResponse.json(
      { error: typeof data.error === "string" ? data.error : "Couldn't start your trial — try again." },
      { status: hosted.status },
    );
  }

  // Cache the account locally so status reconciles against the server window
  // (best-effort — the server row is authoritative regardless).
  await saveTrialEmail(typeof data.email === "string" ? data.email : email);

  // The hosted session cookie arrives as a Set-Cookie header on the hosted
  // response; forward its VALUE (never the header itself — that would plant
  // it on the local origin, useless). The UI hands it to the hosted origin
  // via /api/exe-license/enter before redirecting.
  const setCookie = hosted.headers.get("set-cookie") ?? "";
  const sessionToken = extractSessionToken(setCookie);
  return NextResponse.json({ ...data, sessionToken });
}

/** Pulls the vantra_session JWT out of a hosted Set-Cookie header value. */
function extractSessionToken(setCookie: string): string | null {
  // Set-Cookie values can legally CONTAIN commas (Expires=Wed, 21 Oct ...),
  // so never split on ",". Match the cookie name at a boundary instead:
  // start-of-string or after ";" (same header) or after "," (undocumented
  // multi-cookie fold some proxies produce).
  const m = setCookie.match(/(?:^|[;,]\s*)vantra_session=([^;,\s]+)/);
  return m?.[1] ? safeDecode(m[1]) : null;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
