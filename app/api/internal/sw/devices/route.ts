import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";
import { isSwOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: device inventory for a `sw-` org.
// GET /api/internal/sw/devices?orgId=... → the org's agents as SpaceWorker's
// Device-sync expects them. The SpaceWorker side upserts these into its own
// Device rows keyed by vantraAgentId (Task 92's layer).

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
    select: { id: true, name: true, trmmClientId: true, agentDomainTier: true },
  });
  if (!org || !isSwOrgName(org.name)) {
    return NextResponse.json({ error: "Not a SpaceWorker org." }, { status: 404 });
  }

  // TASK_128 — the auto-move clock SpaceWorker renders in its onboarding
  // strip must be the SAME clock that will actually fire the move, so each
  // agent carries its own row from here. `orderBy createdAt desc` + first-wins
  // = the NEWEST row per agent, exactly what advanceDeviceAutoMove itself
  // reads (device-auto-move.ts:43-47). Additive: existing consumers ignore it.
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
    return NextResponse.json({
      ok: true,
      // TASK_128 — the org's tier, so SpaceWorker can stamp Device.tier from
      // the org the agent was actually listed under (public until the move
      // lands, private after).
      orgTier: org.agentDomainTier,
      devices: agents.map((a) => ({
        vantraAgentId: a.agent_id,
        name: a.hostname,
        online: a.status === "online",
        status: a.status,
        osName: a.plat,
        operatingSystem: a.operating_system,
        publicIp: a.public_ip ?? null,
        lastSeen: a.last_seen,
        // TASK_128 — per-agent move-clock. `null` when no auto-move row exists
        // yet (the first Vantra sweep has not sighted the device). `failed`
        // rows are deliberately NOT filtered out: SpaceWorker needs the status
        // to stop showing a device as stuck in progress.
        autoMove: moveByAgent.get(a.agent_id) ?? null,
      })),
    });
  } catch (err) {
    console.error("sw device list failed:", err);
    return NextResponse.json({ error: "Couldn't list devices." }, { status: 502 });
  }
}