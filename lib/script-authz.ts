import "server-only";

import { canAccessAgent } from "./authz";
import { db } from "./db";

/**
 * A script belongs to whoever wrote it — staff included. Unlike agent access,
 * there is deliberately NO staff bypass here: staff can only run their own
 * scripts. This mirrors how TRMM's global, tenant-unscoped Script table is
 * re-scoped to per-user ownership via our own `Script` rows.
 */
export async function assertScriptOwnedByUser(scriptId: string, userId: string) {
  const script = await db.script.findUnique({ where: { id: scriptId } });
  if (!script || script.userId !== userId) return null;
  return script;
}

/**
 * Gate for "run this script on that agent". The script must be the caller's own
 * (no staff bypass); the agent must be one the caller may act on (staff bypass
 * applies on the AGENT side via canAccessAgent). Returns null on failure.
 */
export async function canRunScriptOnAgent(
  scriptId: string,
  agentId: string,
  user: { id: string; isStaff: boolean; trmmClientId?: number | null },
) {
  const script = await assertScriptOwnedByUser(scriptId, user.id);
  if (!script) return null;
  return (await canAccessAgent(agentId, user)) ? script : null;
}