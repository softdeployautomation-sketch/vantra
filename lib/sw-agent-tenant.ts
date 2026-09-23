import "server-only";

import { db } from "@/lib/db";
import { getAgentDetail, listClients } from "@/lib/trmm";
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
  // 2026-10 bug fix — TRMM's agent serializers changed which client field they
  // expose: older builds carry `client_id` / numeric `client`; the current one
  // only carries `client_name` (string). The org lookup keys on the NUMERIC
  // trmmClientId, so a missing field silently resolved null and every sw-route
  // 404'd "Device not found" even for correctly-installed devices (remote
  // control, run-now, queues all dead on a healthy agent). Resolve robustly:
  // numeric field first, then a clients-list lookup by name.
  let clientId: number | null =
    typeof detail.client_id === "number"
      ? detail.client_id
      : typeof detail.client === "number"
        ? detail.client
        : null;
  if (clientId === null) {
    // 2026-10 LIVE PAYLOAD: `client` is the client NAME (string) and `site` is
    // numeric — `client_name` doesn't exist on this serializer at all. Accept
    // either name field, then resolve the numeric client id via the list.
    const name =
      typeof detail.client_name === "string" && detail.client_name
        ? detail.client_name
        : typeof detail.client === "string" && detail.client
          ? detail.client
          : null;
    if (name) {
      const match = (await listClients()).find((c) => c.name === name);
      if (match) clientId = match.id;
    }
  }
  if (clientId === null) return null;
  const org = await db.organization.findFirst({
    where: { trmmClientId: clientId, name: { startsWith: SW_ORG_PREFIX } },
    select: { name: true },
  });
  return org && isSwOrgName(org.name) ? org.name : null;
}
