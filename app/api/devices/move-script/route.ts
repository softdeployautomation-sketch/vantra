import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { assertAgentBelongsToClient } from "@/lib/authz";
import { db } from "@/lib/db";
import { cancelPendingAutoMoveForManualMove } from "@/lib/device-auto-move";
import { assertPublicMoveSource, resolveMoveDestination } from "@/lib/device-move";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { buildAgentDomainMoveScript, reassignAgentSite } from "@/lib/trmm";

export const dynamic = "force-dynamic";

const moveScriptSchema = z.object({
  agentId: z.string().min(1, "agentId is required"),
  destinationOrgId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified) return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  let parsed: z.infer<typeof moveScriptSchema>;
  try {
    parsed = moveScriptSchema.parse(await request.json().catch(() => ({})));
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const agentId = parsed.agentId.trim();
  if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  let destinationOrgId = parsed.destinationOrgId ?? null;
  if (destinationOrgId) {
    const dest = await db.organization.findUnique({
      where: { id: destinationOrgId },
      select: { id: true, ownerId: true },
    });
    if (!dest || dest.ownerId !== user.id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  } else {
    const active = await getActiveOrganization(user);
    if (!active || active.ownerId !== user.id) {
      return NextResponse.json({ error: "No active organization." }, { status: 409 });
    }
    destinationOrgId = active.id;
  }
  let destination: Awaited<ReturnType<typeof resolveMoveDestination>>;
  try {
    destination = await resolveMoveDestination(destinationOrgId);
  } catch (err) {
    const m = err instanceof Error ? err.message : "Move failed.";
    return NextResponse.json({ error: m }, { status: 409 });
  }
  const ownOrgs = await db.organization.findMany({
    where: { ownerId: user.id },
    select: { id: true, agentDomainTier: true, trmmClientId: true },
  });
  let sourceOrgId: string | null = null;
  for (const o of ownOrgs) {
    if (!o.trmmClientId) continue;
    try {
      if (await assertAgentBelongsToClient(agentId, o.trmmClientId)) {
        sourceOrgId = o.id;
        break;
      }
    } catch {
      // Fail closed: keep scanning.
    }
  }
  if (!sourceOrgId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    await assertPublicMoveSource(sourceOrgId);
  } catch (err) {
    const m = err instanceof Error ? err.message : "Move failed.";
    return NextResponse.json({ error: m }, { status: 409 });
  }
  await cancelPendingAutoMoveForManualMove(agentId, sourceOrgId).catch(() => {});
  try {
    await reassignAgentSite(agentId, destination.siteId);
  } catch (err) {
    console.error("move-script reassign failed:", err);
    await logApiError({
      route: "/api/devices/move-script",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { ok: false, step: "reassign", error: "Could not move the device. Nothing was changed." },
      { status: 502 },
    );
  }
  let script: string;
  try {
    script = buildAgentDomainMoveScript(destination.apiBaseUrl);
  } catch (err) {
    console.error("move-script build failed:", err);
    await logApiError({
      route: "/api/devices/move-script",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { ok: false, step: "reassign", error: "Device filed under private org but command build failed." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, step: "copy", script, sourceOrgId, destinationOrgId });
}