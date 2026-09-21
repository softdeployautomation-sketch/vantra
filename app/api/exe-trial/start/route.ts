import { NextResponse } from "next/server";
import { z } from "zod";

import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findOrCreateExeAccount } from "@/lib/exe-account";
import { resolveExeEligibility } from "@/lib/exe-eligibility";
import { startExeTrialIfNeeded } from "@/lib/exe-trial";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Task 69, scope 1 — POST /api/exe-trial/start — body: { email, password }
//
// The EXE first-launch account gate. Account creation/login semantics are
// SHARED with the existing auth routes via lib/exe-account.ts (same hashing,
// same emailVerified + VerificationCode flow, same generic errors) — no
// second password path anywhere.
//
//   - new email    -> creates a real User, starts the server-side 24h trial,
//                     responds needsVerification (like login) so the client
//                     routes to /verify.
//   - known email  -> verifies the password (an existing customer opening the
//                     EXE for the first time is never told to "sign up"
//                     again), starts the trial only if this account never had
//                     one (idempotent — wiping local EXE state cannot re-trial).
//
// Public per-IP rate limit ("exe-trial-start", same posture as signup). Sets
// the hosted session cookie on the response (same SESSION_COOKIE login uses),
// so a same-origin caller is logged straight in; the local-runtime proxy
// caller forwards this Set-Cookie onto the hosted origin before redirecting
// (a cross-origin Set-Cookie would otherwise be dropped by the browser).
const bodySchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days — mirrors lib/auth.ts

export async function POST(request: Request) {
  if (!(await allowAndRecord(await getClientIp(), "exe-trial-start"))) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const account = await findOrCreateExeAccount({ email: parsed.email, password: parsed.password });
  if (!account.ok) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const trial = await startExeTrialIfNeeded(account.userId);
  const eligibility = await resolveExeEligibility(account.email);

  const token = await createSessionToken({
    sub: account.userId,
    email: account.email,
    emailVerified: account.emailVerified,
  });
  const res = NextResponse.json({
    ok: true,
    isNewAccount: account.isNewAccount,
    needsVerification: !account.emailVerified,
    email: account.email,
    eligible: eligibility.eligible,
    trial: eligibility.trial,
    trialStartedAt: trial.startedAt?.toISOString() ?? null,
    trialEndsAt: trial.endsAt?.toISOString() ?? null,
    trialHoursLeft: trial.hoursLeft,
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
