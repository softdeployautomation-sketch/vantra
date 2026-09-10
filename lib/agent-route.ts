import { NextResponse } from "next/server";

import { canAccessAgent, canAccessPremiumRemoteTools, canPerformAgentAction } from "./authz";
import { getActiveOrganization, getCurrentUser } from "./session-user";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

type AuthResult = { user: CurrentUser } | { response: NextResponse };

/**
 * Shared guard for per-agent routes. Enforces authenticated + verified, then the
 * IDOR ownership check (with staff bypass) against the caller's ACTIVE
 * organization's TRMM client. Returns a 401/403/404 response on failure, or the
 * current user on success.
 */
export async function authorizeAgentAction(agentId: string): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (!user.emailVerified) {
    return { response: NextResponse.json({ error: "Email not verified." }, { status: 403 }) };
  }
  const org = await getActiveOrganization(user);
  const allowed = await canAccessAgent(agentId, {
    isStaff: user.isStaff,
    trmmClientId: org?.trmmClientId ?? null,
  });
  if (!allowed) {
    // 404 (not 403) so we never leak whether another customer's agent exists.
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { user };
}

/**
 * Shared guard for staff-only remote-tools routes (mesh, cmd, maintenance overlay).
 * Requires an authenticated, verified, isStaff user. No ownership check — staff
 * may act on any customer's agent by design.
 *
 * NOTE (V4): Remote Tools is now a premium customer feature — the three RT
 * routes (mesh, cmd, maintenance-overlay) use authorizePremiumAgentAction below
 * instead. This staff guard is retained only for any route that is still
 * genuinely staff-only.
 */
export async function authorizeStaffAction(): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (!user.emailVerified) {
    return { response: NextResponse.json({ error: "Email not verified." }, { status: 403 }) };
  }
  if (!user.isStaff) {
    // Don't leak that the route exists to non-staff.
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { user };
}

/**
 * V4: shared guard for the premium Remote Tools routes (mesh, cmd, maintenance
 * overlay). Premium customer feature — NOT staff-gated. Caller must have an
 * active org on the Premium plan; if so, the agent must belong to that org's own
 * client (IDOR guard). Returns:
 *  - 401 if not authenticated
 *  - 403 "Remote Tools requires a Premium plan" if the active org isn't premium
 *  - 404 (not leaking existence) if premium but not the owner
 */
export async function authorizePremiumAgentAction(
  agentId: string,
): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (!user.emailVerified) {
    return { response: NextResponse.json({ error: "Email not verified." }, { status: 403 }) };
  }
  // Re-verify premium hasn't lapsed (check-on-read; no cron). plan is returned
  // fresh from getActiveOrganization's DB read.
  const org = await getActiveOrganization(user);
  if (org?.plan !== "premium") {
    return {
      response: NextResponse.json(
        { error: "Remote Tools requires a Premium plan." },
        { status: 403 },
      ),
    };
  }
  const allowed = await canAccessPremiumRemoteTools(agentId, {
    plan: org.plan,
    trmmClientId: org.trmmClientId ?? null,
  });
  if (!allowed) {
    // 404 (not 403) so we never leak whether another customer's agent exists.
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { user };
}

/**
 * Task 24: technician-only premium tooling. The same premium + ownership gate
 * as authorizePremiumAgentAction, PLUS a staff requirement. This is the split
 * the product now wants: plain remote control (Full Control / view-only, the
 * mesh endpoints) stays available to any premium customer exactly as before,
 * but the technician tooling — standalone Terminal, Connect to Backend's
 * Backstage, Start Maintenance, and the process/software/service controls — is
 * only usable by staff, regardless of the customer's plan.
 *
 * reuses authorizePremiumAgentAction's own internals (premium + IDOR) rather
 * than duplicating them, then requires user.isStaff on top. Non-staff gets a
 * 404 (not 403) to match this file's "don't leak existence" convention — a
 * premium customer must not even learn the route exists.
 */
export async function authorizePremiumStaffAgentAction(
  agentId: string,
): Promise<AuthResult> {
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result;
  if (!result.user.isStaff) {
    // 404, not 403 -- matches this file's existing "don't leak existence"
    // convention for actions a caller isn't entitled to.
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return result;
}

/**
 * Widened free-tier gating: shared guard for the premium-gated device ACTION
 * routes that previously only checked ownership (reboot, shutdown, ping,
 * run-script). Same shape as authorizePremiumAgentAction — the caller's ACTIVE
 * org must be Premium and the agent must belong to that org's own client (IDOR
 * guard). Returns 403 with a clear "requires Premium" message when the org
 * isn't premium (not a silent failure).
 */
export async function authorizePremiumDeviceAction(
  agentId: string,
): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (!user.emailVerified) {
    return { response: NextResponse.json({ error: "Email not verified." }, { status: 403 }) };
  }
  const org = await getActiveOrganization(user);
  if (org?.plan !== "premium") {
    return {
      response: NextResponse.json(
        { error: "This action requires a Premium plan." },
        { status: 403 },
      ),
    };
  }
  const allowed = await canPerformAgentAction(agentId, {
    plan: org.plan,
    trmmClientId: org.trmmClientId ?? null,
  });
  if (!allowed) {
    // 404 (not 403) so we never leak whether another customer's agent exists.
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { user };
}