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
    select: { id: true, name: true, trmmClientId: true },
  });
  if (!org || !isSwOrgName(org.name)) {
    return NextResponse.json({ error: "Not a SpaceWorker org." }, { status: 404 });
  }

  try {
    const agents = await listAgents(org.trmmClientId ?? undefined);
    return NextResponse.json({
      ok: true,
      devices: agents.map((a) => ({
        vantraAgentId: a.agent_id,
        name: a.hostname,
        online: a.status === "online",
        status: a.status,
        osName: a.plat,
        operatingSystem: a.operating_system,
        publicIp: a.public_ip ?? null,
        lastSeen: a.last_seen,
      })),
    });
  } catch (err) {
    console.error("sw device list failed:", err);
    return NextResponse.json({ error: "Couldn't list devices." }, { status: 502 });
  }
}