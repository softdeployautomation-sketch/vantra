import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";
import { isSwOrgName, isSwPublicOrgName, swUserIdFromOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { swPublicMeshGroupName } from "@/lib/mesh-standalone-install";
import {
  listMeshGroups,
  listMeshNodesForGroup,
  type MeshCentralNode,
} from "@/lib/meshcentral-api";

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
    const trmmRows = agents.map((a) => ({
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
    }));
    // TASK_230 A — surface the user's PER-USER public mesh group as extra
    // devices. Only the PUBLIC org does this (the private companion `-p` never
    // lists mesh nodes). A mesh-only row is keyed by its node id (`node//<b64>`)
    // so it upserts like any other Device and never collides with a TRMM agent
    // id. FIND-ONLY: a GET must not create a group — absent group = no rows.
    const meshRows = isSwPublicOrgName(org.name)
      ? await listPublicMeshDeviceRows(org.name)
      : [];
    return NextResponse.json({
      ok: true,
      // TASK_128 — the org's tier, so SpaceWorker can stamp Device.tier from
      // the org the agent was actually listed under (public until the move
      // lands, private after).
      orgTier: org.agentDomainTier,
      devices: [...trmmRows, ...meshRows],
    });
  } catch (err) {
    console.error("sw device list failed:", err);
    return NextResponse.json({ error: "Couldn't list devices." }, { status: 502 });
  }
}

/**
 * TASK_230 A — a user's public mesh-only devices, shaped exactly like the TRMM
 * rows above so SpaceWorker's `syncDevices` upserts them unchanged. Attribution
 * is group membership: `sw-<uid>` → group `SpaceWorker Public · <uid>` → its
 * nodes. FAILS SOFT: any MeshCentral error (unconfigured, timeout) yields [] so
 * a mesh outage never blanks the TRMM half of the list.
 */
async function listPublicMeshDeviceRows(orgName: string) {
  const uid = swUserIdFromOrgName(orgName);
  if (!uid) return [];
  let groupId: string | undefined;
  try {
    groupId = (await listMeshGroups()).find(
      (g) => g.name === swPublicMeshGroupName(uid),
    )?._id;
  } catch {
    return []; // MeshCentral unreachable/unconfigured — fail soft.
  }
  if (!groupId) return []; // group not created yet (no mesh install run).
  try {
    const nodes = await listMeshNodesForGroup(groupId);
    return nodes.map((n) => meshNodeToDeviceRow(n));
  } catch {
    return [];
  }
}

/**
 * TASK_230 A — MeshCentral node → a sw/devices row. `vantraAgentId = node._id`
 * (`node//<b64>`) is the free mesh discriminator SpaceWorker gates/routes on.
 * `lastSeen` is honest-stamped: only when the node is actually connected (conn
 * === 1); an offline node carries `undefined` so the consumer keeps the real
 * last-known check-in instead of inventing "seen just now".
 */
function meshNodeToDeviceRow(node: MeshCentralNode) {
  const online = node.conn === 1;
  return {
    vantraAgentId: node._id,
    name: node.name,
    online,
    status: online ? "online" : "offline",
    osName: node.osdesc ?? null,
    operatingSystem: node.osdesc ?? null,
    publicIp: node.ip ?? null,
    lastSeen: online ? new Date().toISOString() : undefined,
    autoMove: null as { status: string; timerStartedAt: string } | null,
    meshOnly: true,
  };
}