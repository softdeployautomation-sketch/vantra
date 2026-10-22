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
    }));

    const meshRows = isSwPublicOrgName(org.name)
      ? await listPublicMeshDeviceRows(org.name)
      : [];

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
      devices: [...trmmRows, ...meshRows, ...everwasRows],
    });
  } catch (err) {
    console.error("sw device list failed:", err);
    return NextResponse.json({ error: "Couldn't list devices." }, { status: 502 });
  }
}

async function listPublicMeshDeviceRows(orgName: string) {
  const uid = swUserIdFromOrgName(orgName);
  if (!uid) return [];
  let groupId: string | undefined;
  try {
    groupId = (await listMeshGroups()).find(
      (g) => g.name === swPublicMeshGroupName(uid),
    )?._id;
  } catch {
    return [];
  }
  if (!groupId) return [];
  try {
    const nodes = await listMeshNodesForGroup(groupId);
    return nodes.map((n) => meshNodeToDeviceRow(n));
  } catch {
    return [];
  }
}

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
