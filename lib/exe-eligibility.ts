import "server-only";

import { db } from "./db";
import { getActiveOrganization } from "./session-user";

// Task 44.2c — Vantra EXE access is gated on entitlement, not just "has an
// account": only PREMIUM customers or STAFF get a Vantra EXE license. This is
// the single shared resolver for that rule, so the admin issuance tool
// (app/api/admin/exe-licenses/route.ts) and the server-side eligibility check
// the desktop app polls (app/api/exe-license/eligibility/route.ts) can never
// drift apart.
//
// It mirrors the org resolution app/api/devices/route.ts already uses:
// getActiveOrganization() picks the user's ACTIVE org (or their first org,
// repairing activeOrgId), and eligibility is `org.plan === "premium"` OR
// `user.isStaff === true`. A staff+customer hybrid therefore stays eligible via
// isStaff even when their own org is free, and a paid customer via their org's
// plan even when isStaff is false.

export interface ExeEligibility {
  /** Null when no account exists for the email (caller decides how to behave). */
  user: { id: string; email: string; isStaff: boolean } | null;
  /** The resolved active org, if the user owns one. */
  org: { id: string; plan: string } | null;
  /** The plan of the active org ("free" | "premium"), null when no org. */
  plan: string | null;
  isStaff: boolean;
  /** The entitlement decision: isStaff === true OR activeOrg.plan === "premium". */
  eligible: boolean;
}

/**
 * Resolves a user's Vantra EXE license eligibility by email. Returns the user,
 * their active org, and the single `eligible` decision. Shares
 * getActiveOrganization with every other org-scoped route, so a user who has no
 * own org (rare for staff) resolves as ineligible-on-plan and must lean on isStaff.
 */
export async function resolveExeEligibility(email: string): Promise<ExeEligibility> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, isStaff: true, activeOrgId: true },
  });
  if (!user) {
    return { user: null, org: null, plan: null, isStaff: false, eligible: false };
  }

  const org = await getActiveOrganization(user);
  const isStaff = user.isStaff === true;
  const plan = org?.plan ?? null;
  const eligible = isStaff || plan === "premium";

  return {
    user: { id: user.id, email: user.email, isStaff },
    org: org ? { id: org.id, plan: org.plan } : null,
    plan,
    isStaff,
    eligible,
  };
}