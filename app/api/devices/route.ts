import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { listAgents } from "@/lib/trmm";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// Strips the raw TRMM client_name (the internal `vantra-{userId}` slug — never
// customer-facing, per this project's v1 decision) and any `[vantra:...]`
// internal suffix from the site name, so no internal identifiers leak to the UI.
function sanitizeSiteName(siteName?: string): string | undefined {
  if (!siteName) return undefined;
  return siteName.replace(/\s*\[vantra:[^\]]*\]\s*$/, "").trim() || undefined;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Staff see every agent (no client filter, confirmed live — each carries its
  // own client_name/site_name); customers only their own client's agents.
  const agentListArgs = user.isStaff ? undefined : user.trmmClientId ?? undefined;

  if (!user.isStaff && !user.trmmClientId) {
    // Not yet provisioned — return gracefully; UI can trigger retry.
    return NextResponse.json({ devices: [], provisioned: false, isStaff: false, plan: user.plan });
  }

  let devicesRaw;
  try {
    devicesRaw = await listAgents(agentListArgs);
  } catch (err) {
    console.error("listAgents failed:", err);
    return NextResponse.json(
      { error: "Couldn't reach the device server right now." },
      { status: 502 },
    );
  }

  // For the staff view, resolve each agent's raw `vantra-{userId}` client slug
  // back to the customer's real orgName via Vantra's own User table — done
  // server-side so the raw TRMM value never reaches the client.
  let clientSlugToOrg = new Map<string, string>();
  if (user.isStaff) {
    const users = await db.user.findMany({
      where: { orgName: { not: null } },
      select: { id: true, orgName: true },
    });
    clientSlugToOrg = new Map(
      users
        .filter((u) => u.orgName)
        .map((u) => [`vantra-${u.id}`, u.orgName as string]),
    );
  }

  const devices = devicesRaw.map((a) => ({
    agent_id: a.agent_id,
    hostname: a.hostname,
    status: a.status,
    last_seen: a.last_seen,
    operating_system: a.operating_system,
    orgName: user.isStaff
      ? clientSlugToOrg.get(a.client_name ?? "") ?? undefined
      : undefined,
    siteName: sanitizeSiteName(a.site_name),
  }));

  const activeDeployments = await db.deployment.count({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
  });

  const maxDevices =
    user.plan === "premium" ? env.maxDevicesPremiumTier : env.maxDevicesFreeTier;

  return NextResponse.json({
    devices,
    provisioned: true,
    activeDeployments,
    maxDevices,
    isStaff: user.isStaff,
    plan: user.plan,
  });
}