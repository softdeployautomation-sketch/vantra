import "server-only";

import { canAccessAgent } from "./authz";
import { db } from "./db";
import { getActiveOrganization } from "./session-user";

/**
 * A script belongs to the org that created it. Unlike agent access there is
 * deliberately NO staff bypass here: staff can only run their own scripts. This
 * mirrors how TRMM's global, tenant-unscoped Script table is re-scoped to
 * per-organization ownership via our own `Script` rows.
 */
export async function assertScriptOwnedByUser(scriptId: string, userId: string) {
  const script = await db.script.findUnique({
    where: { id: scriptId },
    include: { organization: { select: { id: true, ownerId: true } } },
  });
  if (!script || script.organization.ownerId !== userId) return null;
  return script;
}

/**
 * Gate for "run this script on that agent". The script must be the caller's own
 * (no staff bypass); the agent must be one the caller may act on (staff bypass
 * applies on the AGENT side via canAccessAgent). Both must additionally share
 * the caller's ACTIVE organization, so a multi-org account can't run org A's
 * script against org B's agent. Returns null on failure.
 */
export async function canRunScriptOnAgent(
  scriptId: string,
  agentId: string,
  user: { id: string; isStaff: boolean; activeOrgId?: string | null },
) {
  const script = await assertScriptOwnedByUser(scriptId, user.id);
  if (!script) return null;
  const org = await getActiveOrganization(user);
  // The script must belong to the SAME active org whose client the agent lives
  // under — prevents a cross-org mismatch within one account.
  if (!org || script.organizationId !== org.id) return null;
  return (
    (await canAccessAgent(agentId, {
      isStaff: user.isStaff,
      trmmClientId: org.trmmClientId ?? null,
    }))
      ? script
      : null
  );
}