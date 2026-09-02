import { NextResponse } from "next/server";

import { canAccessAgent, canAccessPremiumRemoteTools } from "./authz";
import { getCurrentUser } from "./session-user";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

type AuthResult = { user: CurrentUser } | { response: NextResponse };

/**
 * Shared guard for per-agent routes. Enforces authenticated + verified, then the
 * IDOR ownership check (with staff bypass). Returns a 401/403/404 response on
 * failure, or the current user on success.
 */
export async function authorizeAgentAction(agentId: string): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (!user.emailVerified) {
    return { response: NextResponse.json({ error: "Email not verified." }, { status: 403 }) };
  }
  const allowed = await canAccessAgent(agentId, user);
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
 * overlay). Premium customer feature — NOT staff-gated. Caller must be Premium;
 * if so, the agent must belong to their own client (IDOR guard). Returns:
 *  - 401 if not authenticated
 *  - 403 "Remote Tools requires a Premium plan" if not premium
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
  // fresh from getCurrentUser's DB read.
  if (user.plan !== "premium") {
    return {
      response: NextResponse.json(
        { error: "Remote Tools requires a Premium plan." },
        { status: 403 },
      ),
    };
  }
  const allowed = await canAccessPremiumRemoteTools(agentId, user);
  if (!allowed) {
    // 404 (not 403) so we never leak whether another customer's agent exists.
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { user };
}