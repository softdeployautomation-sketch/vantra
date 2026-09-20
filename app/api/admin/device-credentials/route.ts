import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/admin/device-credentials — Task 45: the one admin-facing place that
// reads the device-credential audit trail back. Purely READ-ONLY visibility
// into a sensitive capability (request/store/reveal of device unlock PINs):
//   - live DeviceCredential rows (which devices hold a stored credential today),
//   - in-flight DeviceCredentialRequest rows (incl. the unattended scheduled
//     next-boot ones, so they're visible while pending, not just after landing),
//   - the latest N DeviceCredentialAuditLog rows (who requested/stored/revealed
//     what and when, across all orgs).
// NEVER returns any encrypted/plaintext credential value — this is an
// accountability surface, not a second reveal path (per task scope).
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const credentials = await db.deviceCredential.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      organization: { select: { name: true } },
      requestedByUser: { select: { email: true } },
    },
  });

  const requests = await db.deviceCredentialRequest.findMany({
    where: { status: { in: OPEN_REQUEST_STATUSES } },
    orderBy: { createdAt: "desc" },
    include: {
      organization: { select: { name: true } },
      actorUser: { select: { email: true } },
    },
  });

  const audit = await db.deviceCredentialAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      organization: { select: { name: true } },
      actorUser: { select: { email: true } },
    },
  });

  return NextResponse.json({
    credentials: credentials.map((c) => ({
      agentId: c.agentId,
      platform: c.platform,
      pinLength: c.pinLength,
      orgName: c.organization?.name ?? null,
      requestedByEmail: c.requestedByUser?.email ?? null,
      updatedAt: c.updatedAt,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      platform: r.platform,
      status: r.status,
      schedule: r.schedule,
      bootDelayMinutes: r.bootDelayMinutes,
      timerStartedAt: r.timerStartedAt,
      pinLength: r.pinLength,
      orgName: r.organization?.name ?? null,
      actorEmail: r.actorUser?.email ?? null,
      createdAt: r.createdAt,
    })),
    audit: audit.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      orgName: a.organization?.name ?? null,
      actorEmail: a.actorUser?.email ?? null,
      action: a.action,
      outcome: a.outcome,
      detail: a.detail,
      requestId: a.requestId,
      createdAt: a.createdAt,
    })),
  });
}

// Requests that are still in-flight (a credential has not yet been stored /
// terminally resolved). Notably includes the scheduled next-boot family
// (pending_next_boot, waiting_20_minutes), which run off the cron poller with no
// staff member watching — exactly what this page exists to surface.
const OPEN_REQUEST_STATUSES = [
  "requested",
  "waiting_for_user",
  "credential_received",
  "pending_next_boot",
  "waiting_20_minutes",
];