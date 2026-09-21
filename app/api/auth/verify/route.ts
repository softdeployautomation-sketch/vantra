import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth";
import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { startExeTrialIfNeeded } from "@/lib/exe-trial";
import { ensureOrgProvisioned } from "@/lib/provision";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";
import { consumeVerificationCode } from "@/lib/verify-code";

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export async function POST(request: Request) {
  const ip = await getClientIp();

  let parsed;
  try {
    parsed = verifySchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const email = parsed.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "No account found for that email." },
      { status: 404 },
    );
  }

  if (user.emailVerified) {
    // Already verified — just start a session and redirect to the dashboard.
    // Task 72: keep the shared 24h installer-trial clock aligned for legacy
    // web accounts that verified before the EXE/trial flow existed — idempotent
    // (no-op when a trial already started, including via the EXE), never
    // extends, and never blocks login on failure.
    try {
      await startExeTrialIfNeeded(user.id);
    } catch (err) {
      console.error("Trial-clock start deferred (will retry on installer generation):", err);
    }
    await setSessionCookie({
      sub: user.id,
      email: user.email,
      emailVerified: true,
    });
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  // Rate limit + cap brute-force attempts on the code.
  const allowed = await allowAndRecord(ip, "verify");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  const result = await consumeVerificationCode(user.id, parsed.code);

  switch (result.reason) {
    case "no_code":
      return NextResponse.json(
        { error: "No active verification code. Request a new one." },
        { status: 400 },
      );
    case "expired":
      return NextResponse.json(
        { error: "That code has expired. Request a new one." },
        { status: 410 },
      );
    case "attempts_exhausted":
      return NextResponse.json(
        { error: "Too many incorrect codes. Request a new one." },
        { status: 429 },
      );
    case "invalid":
      return NextResponse.json(
        { error: "That code is incorrect." },
        { status: 400 },
      );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: "Verification failed." },
      { status: 400 },
    );
  }

  // Verified. Mark the user verified, then provision the TRMM Client/Site.
  await db.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });

  // Task 72: start the SAME 24h installer-trial clock Task 69 built for the
  // EXE wrapper (lib/exe-trial.ts — server-authoritative, account-level,
  // idempotent), so a web-only signup gets a real trial window from day one.
  // Best-effort here (never blocks a successful verification): the
  // deployments endpoint re-starts it if genuinely never started, and neither
  // path ever extends an already-started window (web verify + EXE first-launch
  // share the one function on the one user row).
  try {
    await startExeTrialIfNeeded(user.id);
  } catch (err) {
    console.error("Trial-clock start deferred (will retry on installer generation):", err);
  }

  // Provision now, but don't block login if TRMM is briefly unreachable —
  // provisioning retries lazily on the next dashboard load (per plan).
  try {
    await ensureOrgProvisioned(user.id);
  } catch (err) {
    console.error("Provisioning deferred (will retry on next dashboard load):", err);
    await logApiError({
      route: "/api/auth/verify",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
      clientReceivedSuccess: true, // verify itself succeeds — provisioning retries lazily
    });
  }

  await setSessionCookie({
    sub: user.id,
    email: user.email,
    emailVerified: true,
  });

  return NextResponse.json({ ok: true });
}