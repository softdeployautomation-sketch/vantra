import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
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
  try {
    return await handleGet();
  } catch (err) {
    // Top-level safety net: getCurrentUser/getActiveOrganization/the Prisma
    // reads below are ordinary DB calls outside the listAgents try/catch --
    // an unexpected throw there (DB hiccup, etc.) previously escaped as an
    // uncaught exception, which Next renders as a non-JSON error page. The
    // client's fetch then can't parse a JSON `error` field out of it and
    // falls back to the generic "Couldn't load devices." with no detail.
    console.error("GET /api/devices failed:", err);
    await logApiError({ route: "/api/devices", method: "GET", statusCode: 500, error: err });
    return NextResponse.json({ error: "Something went wrong loading your devices." }, { status: 500 });
  }
}

async function handleGet() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Every org-scoped read goes through the user's ACTIVE organization — this
  // now applies to staff too. Staff previously saw every customer's devices
  // unconditionally (no client filter), which meant a device belonging to a
  // DIFFERENT one of a staff+customer hybrid account's own organizations
  // showed up here too — then Remote Tools correctly refused to act on it
  // (canPerformAgentAction has no staff bypass by design), producing a
  // confusing "couldn't load remote-access details" dead end for a device
  // that should never have been listed under this org in the first place.
  // A dedicated staff cross-customer view belongs in /admin101, not here.
  const org = await getActiveOrganization(user);
  const agentListArgs = org?.trmmClientId ?? undefined;

  if (!org?.trmmClientId) {
    // Not yet provisioned — return gracefully; UI can trigger retry.
    return NextResponse.json({
      devices: [],
      provisioned: false,
      isStaff: user.isStaff,
      plan: org?.plan ?? "free",
    });
  }

  let devicesRaw;
  try {
    devicesRaw = await listAgents(agentListArgs);
  } catch (err) {
    console.error("listAgents failed:", err);
    await logApiError({
      route: "/api/devices",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't reach the device server right now." },
      { status: 502 },
    );
  }

  // Customer-editable nicknames (DeviceLabel), keyed by agent_id — one query
  // for the whole list rather than N. Shown instead of TRMM's own site name
  // (often an unmemorable "Default Site"), which stays as a fallback.
  const labels = await db.deviceLabel.findMany({
    where: { organizationId: org.id },
    select: { agentId: true, label: true },
  });
  const labelByAgentId = new Map(labels.map((l) => [l.agentId, l.label]));

  // The list is now always scoped to the active org's own trmmClientId (see
  // above), so every device in it belongs to the same org — no more per-device
  // org-name resolution needed, staff included.
  const devices = devicesRaw.map((a) => ({
    agent_id: a.agent_id,
    hostname: a.hostname,
    status: a.status,
    last_seen: a.last_seen,
    operating_system: a.operating_system,
    siteName: sanitizeSiteName(a.site_name),
    label: labelByAgentId.get(a.agent_id) ?? null,
    // Per-device check counts (incl. `has_failing_checks`) — passed straight
    // through from listAgents, which already returns them. Needed by the
    // dashboard KPI row's "devices with failing checks" tile; no new TRMM call.
    checks: a.checks,
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