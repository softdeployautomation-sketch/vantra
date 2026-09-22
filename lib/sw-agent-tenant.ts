import "server-only";

import { db } from "@/lib/db";
import { getAgentDetail } from "@/lib/trmm";
import { isSwOrgName, SW_ORG_PREFIX } from "@/lib/spaceworker-service";

// Task 95 — shared tenant guard for the SpaceWorker internal device-tool
// routes. Same logic as the local copy in
// app/api/internal/sw/devices/[agentId]/action/route.ts (Task 93) — extracted
// so the new mesh/maintenance/pin/queue routes enforce the IDENTICAL check:
// the agent must belong to a TRMM client that maps to a `sw-*` org, else the
// route behaves as if the agent doesn't exist (404, not 403 — a prober can't
// even confirm the agent exists).

export async function assertAgentInSwOrg(agentId: string): Promise<string | null> {
  const detail = await getAgentDetail(agentId);
  // AgentDetail carries client_id (TRMM detail payload); fall back to the
  // client row matched by the agent's client name if the field is absent.
  const clientId =
    typeof detail.client_id === "number"
      ? detail.client_id
      : typeof detail.client === "number"
        ? detail.client
        : null;
  if (clientId === null) return null;
  const org = await db.organization.findFirst({
    where: { trmmClientId: clientId, name: { startsWith: SW_ORG_PREFIX } },
    select: { name: true },
  });
  return org && isSwOrgName(org.name) ? org.name : null;
}
