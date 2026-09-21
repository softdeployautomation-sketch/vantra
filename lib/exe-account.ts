import "server-only";

import { hashPassword, verifyPassword } from "./auth";
import { db } from "./db";
import { sendEmail, verificationEmailHtml } from "./email";
import { ensureOrgProvisioned } from "./provision";
import { notifyAdmin } from "./telegram";
import { issueVerificationCode } from "./verify-code";

// Task 69, scope 1 — shared EXE-trial account helper. The spec reuses the
// EXISTING /api/auth/signup + /api/auth/login semantics (same hashing, same
// emailVerified + VerificationCode flow, same generic errors) — this module
// is that sharing point, so neither the trial route nor any other caller
// ever hand-rolls a second password path. As an internal function (not an
// HTTP call) it takes no rate-limit of its own: callers keep their own
// public-route limits (signup/login/exe-trial-start) at the route boundary.
export type ExeAccountResult =
  | { ok: true; userId: string; email: string; isNewAccount: boolean; emailVerified: boolean }
  | { ok: false; status: 401 | 409; error: string };

/**
 * Finds the account for `email`, or creates it exactly the way
 * POST /api/auth/signup does (hashPassword, emailVerified: false,
 * VerificationCode + verification email, admin ping, best-effort org
 * provisioning). An existing account authenticates exactly the way POST
 * /api/auth/login does (verifyPassword, same generic "Invalid email or
 * password." error — never a "sign up again" message, never an existence
 * oracle beyond signup's own 409).
 */
export async function findOrCreateExeAccount(input: {
  email: string;
  password: string;
}): Promise<ExeAccountResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    const valid = await verifyPassword(input.password, existing.passwordHash);
    if (!valid) {
      return { ok: false, status: 401, error: "Invalid email or password." };
    }
    return {
      ok: true,
      userId: existing.id,
      email: existing.email,
      isNewAccount: false,
      emailVerified: existing.emailVerified,
    };
  }

  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: { email, passwordHash, emailVerified: false },
  });

  void notifyAdmin(`👤 New Vantra signup (EXE trial): ${email}`);
  const { code } = await issueVerificationCode(user.id);
  try {
    await sendEmail({
      to: email,
      subject: "Your Vantra verification code",
      html: verificationEmailHtml(code),
    });
  } catch {
    // Same posture as /api/auth/signup: the account stands, the user can
    // resend from the verify page.
  }
  try {
    await ensureOrgProvisioned(user.id);
  } catch (err) {
    console.error("EXE trial provisioning deferred:", err);
  }

  return { ok: true, userId: user.id, email: user.email, isNewAccount: true, emailVerified: false };
}
