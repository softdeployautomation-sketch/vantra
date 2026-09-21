import "server-only";

import { headers } from "next/headers";

import { db } from "./db";

// IP-based rate limiting via the RateLimitEvent table. Fine at single-instance
// scale (per plan); move to Redis if Vantra ever runs multiple instances.

export type RateLimitKind =
  | "signup"
  | "login"
  | "resend-code"
  | "verify"
  | "admin-login"
  | "billing-manual-submit"
  | "admin-service-action"
  | "desktop-sync-pull"
  | "desktop-sync-push"
  | "exe-license-auto-bind"
  | "exe-license-eligibility"
  | "exe-trial-start"
  | "exe-trial-reconcile"
  | "support-contact"
  | "device-credential-callback";

interface Rule {
  /** Number of events allowed within the window. */
  limit: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
}

/**
 * Guardrail limits (per plan §Guardrails):
 *  - signup:      5/hr
 *  - login:      10/hr
 *  - resend-code: 1/60s AND 5/hr (both enforced)
 *  - verify:     10 attempts cap (short window is effectively a cap via limit)
 */
const RULES: Record<RateLimitKind, Rule[]> = {
  signup: [{ limit: 5, windowMs: 60 * 60 * 1000 }],
  login: [{ limit: 10, windowMs: 60 * 60 * 1000 }],
  "resend-code": [
    { limit: 1, windowMs: 60 * 1000 },
    { limit: 5, windowMs: 60 * 60 * 1000 },
  ],
  verify: [{ limit: 10, windowMs: 60 * 60 * 1000 }],
  // Admin shared-passcode login — same posture as the customer login.
  "admin-login": [{ limit: 10, windowMs: 60 * 60 * 1000 }],
  // Manual crypto tx-hash submission — 5/hr/IP (per plan §V4.1).
  "billing-manual-submit": [{ limit: 5, windowMs: 60 * 60 * 1000 }],
  // Admin service start/stop/restart — safety valve against double-click/retry
  // storms bouncing celery, not a security control.
  "admin-service-action": [
    { limit: 6, windowMs: 60 * 1000 },
    { limit: 40, windowMs: 60 * 60 * 1000 },
  ],
  // Task 46 — desktop-sync mirror (pull + push), per-IP defense in depth. The
  // install secret is the real auth; this just bounds flood noise from a single
  // client behind any given public IP. Generous (20/min each) so a legitimate
  // install polling every few seconds is never throttled, yet a scripted storm
  // is cut off.
  "desktop-sync-pull": [{ limit: 1200, windowMs: 60 * 60 * 1000 }],
  "desktop-sync-push": [{ limit: 1200, windowMs: 60 * 60 * 1000 }],
  // Task 47 — hosted, session-less EXE-license + device-callback routes. Each
  // still needs a valid signature/one-time token to do anything meaningful, but
  // they run real Prisma queries (and auto-bind writes) per request with no
  // throttle; bound the noise volume so a scripted flood can't add cheap load to
  // the shared Postgres regardless of whether it sends valid credentials.
  "exe-license-auto-bind": [{ limit: 10, windowMs: 60 * 60 * 1000 }],
  "exe-license-eligibility": [{ limit: 30, windowMs: 60 * 60 * 1000 }],
  // Task 69 — server-side trial start (public, per-IP). Same posture as
  // signup: a handful per hour is plenty for genuine first launches.
  // Reconcile runs on a SEPARATE bucket (same limit): the local runtime
  // polls it on every status check while trialEmail is cached, so sharing
  // one bucket with start would let background polls throttle a real re-try
  // of the account screen on a flaky first launch.
  "exe-trial-start": [{ limit: 10, windowMs: 60 * 60 * 1000 }],
  "exe-trial-reconcile": [{ limit: 60, windowMs: 60 * 60 * 1000 }],
  // Task 69 — locked-out contact surface (public, per-IP). Generous enough
  // for a genuine retry, tight enough to bound inbox spam.
  "support-contact": [{ limit: 5, windowMs: 60 * 60 * 1000 }],
  "device-credential-callback": [{ limit: 20, windowMs: 60 * 60 * 1000 }],
};

export async function getClientIp(): Promise<string> {
  const h = await headers();
  // Trust the first proxy-provided X-Forwarded-For entry (nginx sets it).
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

async function countInWindow(ip: string, kind: RateLimitKind, windowMs: number) {
  const since = new Date(Date.now() - windowMs);
  return db.rateLimitEvent.count({
    where: {
      ip,
      kind,
      createdAt: { gte: since },
    },
  });
}

/**
 * Records one event and returns true if the caller is still allowed.
 * Call BEFORE performing the action, then record the result after the action.
 * (Recording first prevents bypassing the cap by never hitting the action.)
 */
export async function allowAndRecord(ip: string, kind: RateLimitKind): Promise<boolean> {
  const rules = RULES[kind];
  for (const rule of rules) {
    const count = await countInWindow(ip, kind, rule.windowMs);
    if (count >= rule.limit) {
      return false;
    }
  }
  await db.rateLimitEvent.create({ data: { ip, kind } });
  return true;
}

/** Returns the remaining attempts available for the kind (for client messaging). */
export async function remainingAttempts(
  ip: string,
  kind: RateLimitKind,
): Promise<number> {
  const rules = RULES[kind];
  const seen: Record<number, number> = {};
  let min = Infinity;
  for (const rule of rules) {
    const key = rule.windowMs;
    if (seen[key] !== undefined) {
      min = Math.min(min, seen[key]);
      continue;
    }
    const count = await countInWindow(ip, kind, rule.windowMs);
    const rem = rule.limit - count;
    seen[key] = rem;
    min = Math.min(min, rem);
  }
  return Math.max(0, min);
}