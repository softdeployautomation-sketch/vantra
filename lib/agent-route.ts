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