import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { moveDeviceToPrivate } from "@/lib/device-move";
import { cancelPendingAutoMoveForManualMove } from "@/lib/device-auto-move";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// TASK_228 — manual "Move to private" (owner redesign 2026-10-19).
// POST /api/internal/sw/devices/[agentId]/move
//
// SpaceWorker's per-device "Move to private" button lands here. The silent
// auto-move is GONE for `sw-` orgs (org flag default false on provisioning +
// every live row cancelled on the box) because its two-step script rewrote the
// agent's BaseURL and force-restarted `tacticalrmm` — with the box offline that
// stranded devices forever (triage 2026-10-19: "a lot of devices have gone
// missing after getting on"). Moving is now an explicit human action, and this
// route is the only mover for sw devices.
//
// TENANT CHECK: same shared guard as every sw route — the agent must resolve to
// an `sw-`-prefixed org, else 404 (never 403; a prober must not learn "unknown"
// from "not yours").
//
// Destination: the deterministic companion `sw-<uid>-p`, mirroring
// device-auto-move.ts:77-89. A sw- source's owner is the SHARED service user,
// so "owner's first private org" would leak across SpaceWorker users — the
// `<name>-p` companion is per-user and already exists (premium provisioning).
// Answer 200 { ok:false, reason:"no_private_org" } when it doesn't exist yet.
//
// D6 answer shape: always HTTP 200 with { ok:true, moved } or
// { ok:false, reason } so a caller checking only status can't mistake a
// business-logic refusal for success. A manual move supersedes any pending
// auto-move row (defence in depth: the box flag already cancels them; this
// covers stale orgs that never got the flag flip).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;
  const swOrgName = await assertAgentInSwOrg(agentId);
  if (!swOrgName) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  const source = await db.organization.findFirst({
    where: { name: swOrgName },
    select: { id: true, ownerId: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  const dest = await db.organization.findFirst({
    where: {
      ownerId: source.ownerId,
      name: `${swOrgName}-p`,
      agentDomainTier: "private",
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!dest) {
    return NextResponse.json({ ok: false, reason: "no_private_org" });
  }
  try {
    // Same two calls the old poller made on fire, in the safe order: the move
    // first (the user's goal), then supersede any live auto-move row so the
    // poller never re-fires this agent out of the private org it just landed in.
    await moveDeviceToPrivate(agentId, source.id, dest.id);
    await cancelPendingAutoMoveForManualMove(agentId, source.id);
    return NextResponse.json({ ok: true, moved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    return NextResponse.json({ ok: false, reason: message.slice(0, 200) });
  }
}
