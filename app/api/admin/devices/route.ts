import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// GET /api/admin/devices?orgId=X — Task 44 req #11 (bulk admin remote cmd,
// 2026-09-19). Lists ONE customer's TRMM devices for the admin devices page
// (app/admin101/(protected)/devices). Deliberately takes an orgId, never a
// raw trmmClientId from the client, so the server is always the one
// resolving "which client does this org actually own" — a tampered request
// naming a different client id has no way to smuggle another customer's
// devices into view.
export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const orgId = new URL(request.url).searchParams.get("orgId")?.trim();
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: { owner: { select: { email: true } } },
  });
  if (!org || !org.trmmClientId) {
    return NextResponse.json({ error: "That organization has no devices." }, { status: 404 });
  }

  try {
    const agents = await listAgents(org.trmmClientId);
    return NextResponse.json({
      orgId: org.id,
      orgName: org.name,
      ownerEmail: org.owner.email,
      devices: agents.map((a) => ({
        agentId: a.agent_id,
        hostname: a.hostname,
        status: a.status,
        lastSeen: a.last_seen,
        operatingSystem: a.operating_system,
      })),
    });
  } catch (err) {
    console.error("Failed to list devices for admin devices page:", err);
    return NextResponse.json({ error: "Couldn't reach the device fleet service." }, { status: 502 });
  }
}
