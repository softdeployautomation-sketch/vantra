import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";
import { isSwOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { syncDevices, mapEverwasDevice } from "@/lib/everwas-client";

export const dynamic = "force-dynamic";

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
    select: { id: true, name: true, trmmClientId: true, agentDomainTier: true, everwasSiteId: true },
  });
  if (!org || !isSwOrgName(org.name)) {
    return NextResponse.json({ error: "Not a SpaceWorker org." }, { status: 404 });
  }

  const moves = await db.deviceAutoMove.findMany({
    where: { sourceOrgId: org.id },
    orderBy: { createdAt: "desc" },
    select: { agentId: true, status: true, timerStartedAt: true },
  });
  const moveByAgent = new Map<string, { status: string; timerStartedAt: string }>();
  for (const m of moves) {
    if (!moveByAgent.has(m.agentId)) {
      moveByAgent.set(m.agentId, {
        status: m.status,
        timerStartedAt: m.timerStartedAt.toISOString(),
      });
    }
  }

  try {
    const agents = await listAgents(org.trmmClientId ?? undefined);
    const trmmRows = agents.map((a) => ({
      vantraAgentId: a.agent_id,
      name: a.hostname,
      online: a.status === "online",
      status: a.status,
      osName: a.plat,
      operatingSystem: a.operating_system,
      publicIp: a.public_ip ?? null,
      lastSeen: a.last_seen,
      autoMove: moveByAgent.get(a.agent_id) ?? null,
      // Which backend owns this row. SpaceWorker keys behaviour off this
      // (additive): the hide-on-enrollment quarantine is a TRMM/mesh concern
      // and must never run against an Everwas device (2026-10-22 — it 404'd
      // and painted "Hide failed" on a healthy public Everwas row).
      engine: "trmm" as const,
    }));

    // 2026-10-22 — public-mesh surfacing is RETIRED. Public devices are
    // Everwas-only now; the old `SpaceWorker Public · <uid>` mesh path was the
    // source of "device moves back to public after the private agent is
    // removed" (a leftover public mesh node re-surfaced the machine on the
    // next sync). The public mesh groups/nodes have been deleted and this
    // branch no longer queries MeshCentral at all, so a stray node can never
    // resurrect a device. Private orgs still get TRMM rows (engine "trmm");
    // public orgs get TRMM rows (if any) + Everwas rows.

    // Everwas devices: fetch from Everwas sync API if org has a site
    let everwasRows: ReturnType<typeof mapEverwasDevice>[] = [];
    if (org.everwasSiteId) {
      try {
        const ewDevices = await syncDevices(org.everwasSiteId);
        everwasRows = ewDevices.map(mapEverwasDevice);
      } catch (err) {
        // Fail soft like mesh: log but don't break TRMM list
        console.error("Everwas sync failed:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      orgTier: org.agentDomainTier,
      devices: [...trmmRows, ...everwasRows],
    });
  } catch (err) {
    console.error("sw device list failed:", err);
    return NextResponse.json({ error: "Couldn't list devices." }, { status: 502 });
  }
}
