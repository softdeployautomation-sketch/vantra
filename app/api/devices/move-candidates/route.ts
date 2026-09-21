import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { listAgents } from "@/lib/trmm";

export const dynamic = "force-dynamic";

/**
 * Task 70: move candidates for the private-org Add Device page.
 * GET /api/devices/move-candidates
 *
 * Returns the caller's OWN public-org devices (the exact device set Task 63's
 * move button allows — a device sitting in one of the caller's own
 * public-tier orgs) plus the destination (the caller's ACTIVE org, which must
 * be a private-tier org they own — the page this is called from).
 *
 * Customer-only, display + picker source. The POST move-script endpoint below
 * re-enforces ownership/direction — this is never the only check.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  const active = await getActiveOrganization(user);
  if (!active || active.ownerId !== user.id) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
  }
  if (active.agentDomainTier !== "private") {
    return NextResponse.json(
      { error: "Move commands are only generated from a private organization." },
      { status: 403 },
    );
  }

  const ownOrgs = await db.organization.findMany({
    where: { ownerId: user.id },
    select: { id: true, name: true, agentDomainTier: true, trmmClientId: true },
    orderBy: { createdAt: "asc" },
  });
  const publicOrgs = ownOrgs.filter((o) => o.agentDomainTier !== "private" && o.trmmClientId);

  const devices: Array<{
    agentId: string;
    hostname: string;
    status: string;
    sourceOrgId: string;
    sourceOrgName: string;
  }> = [];
  let anySuccess = false;
  let lastError: unknown = null;
  for (const o of publicOrgs) {
    try {
      const agents = await listAgents(o.trmmClientId ?? undefined);
      anySuccess = true;
      for (const a of agents) {
        devices.push({
          agentId: a.agent_id,
          hostname: a.hostname,
          status: a.status,
          sourceOrgId: o.id,
          sourceOrgName: o.name?.trim() ? o.name : "Unnamed organization",
        });
      }
    } catch (err) {
      // Fail soft per-org (one unreachable client must not hide the others);
      // fail closed overall below when NOTHING could be listed.
      console.error("move-candidates listAgents failed for org", o.id, err);
      lastError = err;
    }
  }

  if (!anySuccess && publicOrgs.length > 0) {
    await logApiError({
      route: "/api/devices/move-candidates",
      method: "GET",
      statusCode: 502,
      error: lastError ?? "Couldn't reach the device server.",
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't reach the device server right now." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    destination: {
      id: active.id,
      name: active.name?.trim() ? active.name : "Unnamed organization",
    },
    devices,
  });
}
