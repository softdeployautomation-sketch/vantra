import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";
import { isSwOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import {
  listMeshNodes,
  matchMeshNode,
  MESHCENTRAL_IDLETIME_UNIT,
  toIdleSeconds,
} from "@/lib/meshcentral-api";

export const dynamic = "force-dynamic";

// Task 106 (bit C1) — SpaceWorker plugin: bulk idle for a `sw-` org.
// GET /api/internal/sw/devices/idle?orgId=... → ONE org-scoped call returning
// `Record<hostname, idleSeconds>` from a single `{"action":"nodes"}` round
// trip. N+1 per-agent calls are not acceptable, so SpaceWorker calls THIS
// (once per linked org) instead of looping the per-agent `[agentId]/idle`
// route. Fail-soft: mesh unavailable → 200 with an empty map.

export async function GET(request: Request) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, trmmClientId: true },
  });
  if (!org || !isSwOrgName(org.name)) {
    return NextResponse.json({ error: "Not a SpaceWorker org." }, { status: 404 });
  }

  try {
    const agents = await listAgents(org.trmmClientId ?? undefined);
    let idleByHostname: Record<string, number | null> = {};
    try {
      const nodes = await listMeshNodes();
      for (const a of agents) {
        const match = matchMeshNode(nodes, a.hostname, a.public_ip ?? undefined);
        const idle = match ? toIdleSeconds(match.idletime) : null;
        if (idle !== null) idleByHostname[a.hostname] = idle;
      }
    } catch {
      idleByHostname = {};
    }
    return NextResponse.json({
      ok: true,
      idleByHostname,
      idleUnit: MESHCENTRAL_IDLETIME_UNIT,
    });
  } catch (err) {
    console.error("sw bulk idle failed:", err);
    return NextResponse.json({
      ok: true,
      idleByHostname: {},
      idleUnit: MESHCENTRAL_IDLETIME_UNIT,
    });
  }
}
