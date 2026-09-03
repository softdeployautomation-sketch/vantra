import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { listAgents } from "@/lib/trmm";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// Strips the raw TRMM client_name (the internal `vantra-{userId}` / `vantra-{userId}-{orgId}`
// slug — never customer-facing, per this project's v1 decision) and any `[vantra:...]`
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

  // Every org-scoped read goes through the user's ACTIVE organization.
  const org = await getActiveOrganization(user);

  // Staff see every agent (no client filter, confirmed live — each carries its
  // own client_name/site_name); customers only their active org's client's agents.
  const agentListArgs = user.isStaff ? undefined : org?.trmmClientId ?? undefined;

  if (!user.isStaff && !org?.trmmClientId) {
    // Not yet provisioned — return gracefully; UI can trigger retry.
    return NextResponse.json({
      devices: [],
      provisioned: false,
      isStaff: false,
      plan: org?.plan ?? "free",
    });
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

  // For the staff view, resolve each agent's raw `vantra-{userId}` /
  // `vantra-{userId}-{orgId}` client slug back to the customer's org name via
  // Vantra's own Organization table — done server-side so the raw TRMM value
  // never reaches the client. Backfilled first orgs keep the legacy `vantra-{userId}`
  // slug, so match either candidate slug per org.
  let clientSlugToOrg = new Map<string, string>();
  if (user.isStaff) {
    const orgs = await db.organization.findMany({
      select: { id: true, name: true, ownerId: true },
    });
    clientSlugToOrg = new Map(
      orgs
        .filter((o) => o.name)
        .flatMap((o) => {
          const candidates = [`vantra-${o.ownerId}-${o.id}`, `vantra-${o.ownerId}`];
          return candidates.map((slug) => [slug, o.name] as const);
        }),
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

  // NOTE: must fail closed on no-org rather than pass organizationId: undefined —
  // Prisma drops an undefined where-key entirely, which would count every
  // organization's deployments instead of none (reachable for staff without
  // their own org, since the early-return above only covers non-staff).
  const activeDeployments = org
    ? await db.deployment.count({
        where: { organizationId: org.id, expiresAt: { gt: new Date() } },
      })
    : 0;

  const maxDevices =
    org?.plan === "premium" ? env.maxDevicesPremiumTier : env.maxDevicesFreeTier;

  return NextResponse.json({
    devices,
    provisioned: true,
    activeDeployments,
    maxDevices,
    isStaff: user.isStaff,
    plan: org?.plan ?? "free",
  });
}