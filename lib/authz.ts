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