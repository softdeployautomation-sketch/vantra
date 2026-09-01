import { NextResponse } from "next/server";

import { canAccessAgent } from "./authz";
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