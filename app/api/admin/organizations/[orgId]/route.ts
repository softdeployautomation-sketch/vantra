import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// Task 73 — admin deletes an ORGANIZATION with an explicit warning.
// Sibling of the grant-premium route. TRMM is READ-ONLY here (live device
// count only) — the TRMM client/site are left orphaned, never deleted.
async function liveDeviceCount(trmmClientId: number | null): Promise<number> {
  if (trmmClientId == null) return 0;
  try {
    const agents = await listAgents(trmmClientId);
    return agents.length;
  } catch {
    return -1;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { orgId } = await params;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true, name: true, plan: true, agentDomainTier: true,
      trmmClientId: true, trmmSiteId: true,
    },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }
  const deviceCount = await liveDeviceCount(org.trmmClientId);
  return NextResponse.json({
    id: org.id, name: org.name, tier: org.agentDomainTier, plan: org.plan,
    trmmClientId: org.trmmClientId, trmmSiteId: org.trmmSiteId, deviceCount,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { orgId } = await params;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, ownerId: true, trmmClientId: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }
  const deviceCount = await liveDeviceCount(org.trmmClientId);
  if (deviceCount < 0) {
    return NextResponse.json(
      { error: "Couldn't reach TRMM to verify devices. Nothing deleted — try again." },
      { status: 502 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    confirmName?: unknown; deviceCountSeen?: unknown;
  };
  if (deviceCount > 0) {
    // Unnamed orgs (name "") can't be confirmed by name — require "DELETE".
    const expected = org.name.trim().length > 0 ? org.name : "DELETE";
    if (typeof body.confirmName !== "string" || body.confirmName !== expected) {
      return NextResponse.json(
        { error: "Type the exact organization name to confirm. Nothing was deleted." },
        { status: 409 },
      );
    }
    if (body.deviceCountSeen !== deviceCount) {
      return NextResponse.json(
        { error: `Device count changed (now ${deviceCount}). Re-open the dialog — nothing was deleted.` },
        { status: 409 },
      );
    }
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.deployment.deleteMany({ where: { organizationId: org.id } });
      await tx.desktopDeviceMirror.deleteMany({ where: { organizationId: org.id } });
      const groups = await tx.deviceGroup.findMany({
        where: { organizationId: org.id }, select: { id: true },
      });
      if (groups.length > 0) {
        await tx.deviceGroupMember.deleteMany({
          where: { groupId: { in: groups.map((g) => g.id) } },
        });
      }
      await tx.deviceGroup.deleteMany({ where: { organizationId: org.id } });
      await tx.script.deleteMany({ where: { organizationId: org.id } });
      await tx.deviceLabel.deleteMany({ where: { organizationId: org.id } });
      await tx.technicianSessionLog.deleteMany({ where: { organizationId: org.id } });
      await tx.deviceCredentialRequest.deleteMany({ where: { organizationId: org.id } });
      await tx.deviceCredential.deleteMany({ where: { organizationId: org.id } });
      await tx.deviceCredentialAuditLog.deleteMany({ where: { organizationId: org.id } });
      await tx.desktopInstall.deleteMany({ where: { organizationId: org.id } });
      await tx.deviceAutoMove.deleteMany({
        where: { OR: [{ sourceOrgId: org.id }, { destinationOrgId: org.id }] },
      });
      await tx.organization.delete({ where: { id: org.id } });
      const owner = await tx.user.findUnique({
        where: { id: org.ownerId }, select: { id: true, activeOrgId: true },
      });
      if (owner && owner.activeOrgId === org.id) {
        const next = await tx.organization.findFirst({
          where: { ownerId: org.ownerId },
          orderBy: { createdAt: "asc" }, select: { id: true },
        });
        await tx.user.update({
          where: { id: org.ownerId },
          data: { activeOrgId: next ? next.id : null },
        });
      }
    });
  } catch (err) {
    console.error("admin delete organization failed:", err);
    await logApiError({
      route: "/api/admin/organizations/[orgId]",
      method: "DELETE", statusCode: 500, error: err, userId: org.ownerId,
    });
    return NextResponse.json(
      { error: "Couldn't delete the organization. Check the org list and try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id: org.id, deletedDevices: deviceCount });
}

