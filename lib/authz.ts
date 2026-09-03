import "server-only";

import { listAgents } from "./trmm";

/**
 * Closes the cross-tenant IDOR gap: one shared TRMM API key serves all
 * customers, and agent_id is guessable/enumerable. Before acting on ANY agent,
 * a customer-facing route MUST confirm the agent actually belongs to that
 * customer's TRMM client; otherwise customer A could reboot customer B's device.
 */
export async function assertAgentBelongsToClient(
  agentId: string,
  trmmClientId?: number | null,
): Promise<boolean> {
  if (!trmmClientId) return false;
  try {
    const agents = await listAgents(trmmClientId);
    return agents.some((a) => a.agent_id === agentId);
  } catch (err) {
    console.error("assertAgentBelongsToClient failed:", err);
    return false; // fail closed — never grant access on an error
  }
}

/**
 * Authorization gateway for a single agent.
 * - Authorized customer: the agent belongs to their own TRMM client.
 * - Staff: may act on ANY customer's agent (by design) — skip the ownership check.
 */
export async function canAccessAgent(
  agentId: string,
  user: { isStaff: boolean; trmmClientId?: number | null },
): Promise<boolean> {
  if (user.isStaff) return true;
  return assertAgentBelongsToClient(agentId, user.trmmClientId);
}

/**
 * Authorization for the premium Remote Tools path (mesh, cmd, maintenance
 * overlay). This is a customer feature, NOT staff-gated: the caller must be
 * Premium AND the agent must belong to their own client. No staff bypass — a
 * customer's own devices only, never cross-tenant.
 */
export async function canAccessPremiumRemoteTools(
  agentId: string,
  user: { plan?: string | null; trmmClientId?: number | null },
): Promise<boolean> {
  if (user.plan !== "premium") return false;
  return assertAgentBelongsToClient(agentId, user.trmmClientId);
}

/**
 * Authorization for premium-gated device ACTIONS (reboot, shutdown, ping, run-script).
 * These are customer features and require the caller's ACTIVE org to be on the
 * Premium plan. Like Remote Tools, no staff bypass — the agent must belong to
 * the caller's own client (IDOR guard) and never to another customer's device.
 *
 * Distinguished from the free read/status paths: adding a device and viewing its
 * status/checks stay ungated; only actions ON a device get gated here.
 */
export async function canPerformAgentAction(
  agentId: string,
  user: { plan?: string | null; trmmClientId?: number | null },
): Promise<boolean> {
  if (user.plan !== "premium") return false;
  return assertAgentBelongsToClient(agentId, user.trmmClientId);
}