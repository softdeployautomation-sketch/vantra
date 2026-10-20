import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { cancelPendingAutoMoveForManualMove } from "@/lib/device-auto-move";
import { swPublicMeshGroupNameForNode } from "@/lib/meshcentral-api";
import { swUidFromPublicMeshGroupName } from "@/lib/mesh-standalone-install";
import { swOrgName as swOrgNameForUid } from "@/lib/spaceworker-service";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { createManualInstaller } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// TASK_228 — manual "Move to private" (owner redesign 2026-10-19).
// POST /api/internal/sw/devices/[agentId]/move
//
// TASK_230 A.4/A.6 — THIS ROUTE NO LONGER MOVES ANYTHING. The old body called
// moveDeviceToPrivate → the two-step script that rewrote the LIVE agent's
// BaseURL and force-restarted tacticalrmm — the kill path that stranded
// devices whenever the private domain wasn't reachable mid-restart (triage
// 2026-10-19; §Decisions LOCKED #3: never reconfig, for sw orgs, permanently).
//
// The replacement flow is install→verify→remove, and this route is step 1
// (INSTALL plan):
//   - it mints the PRIVATE-tier manual installer (same createManualInstaller
//     call the private install-link branch uses — PowerShell-native, baked
//     against env.trmmPrivateApiBaseUrl), so the USER runs the install on the
//     device from a stable base; nothing is pushed to a live agent;
//   - move/verify confirms the device re-appeared under the private companion
//     org (by hostname) before move/remove will delete the old public record —
//     see ./verify and ./remove for the enforced ordering.
// The device's CURRENT state is untouched by every step of this route: if the
// user never runs the command, nothing happened. No half-moved state is
// possible, which is exactly the property the old live move could not offer.
//
// TENANT CHECK: same shared guard as every sw route — the agent must resolve to
// an `sw-`-prefixed org, else 404 (never 403; a prober must not learn "unknown"
// from "not yours").
//
// Destination: the deterministic companion `sw-<uid>-p` (unchanged from 228).
// Answer 200 { ok:false, reason:"no_private_org" } when it doesn't exist yet.
// Any manual flow still supersedes pending auto-move rows (defence in depth —
// TASK_230 A.6 already blocks sw sources from arming at all).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;
  // TASK_234 B3 — MESH branch. `assertAgentInSwOrg` resolves TRMM agent ids
  // only (getAgentDetail 404s a `node//` id), so every Move on a public
  // mesh-only row died here as "Device not found". Attribution for a mesh
  // node = its PUBLIC GROUP: per-user group `SpaceWorker Public · <uid>` →
  // the same `sw-<uid>` org the TRMM path resolves (swOrgName). Failures —
  // node not found / non-SW group / shared pre-230 pool (no uid) / no such
  // org — all answer the SAME 404, never confirming existence (guard posture
  // unchanged: 404 never 403). The shared pool gets no uid → no tenant is
  // ever guessed from a group name.
  let swOrgName: string | null;
  if (agentId.startsWith("node//")) {
    try {
      const groupName = await swPublicMeshGroupNameForNode(agentId);
      const uid = swUidFromPublicMeshGroupName(groupName);
      swOrgName = uid ? swOrgNameForUid(uid) : null;
    } catch {
      swOrgName = null;
    }
  } else {
    swOrgName = await assertAgentInSwOrg(agentId);
  }
  if (!swOrgName) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  const source = await db.organization.findFirst({
    where: { name: swOrgName },
    select: { id: true, ownerId: true, agentDomainTier: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  // Private already? Nothing to plan.
  if (source.agentDomainTier === "private") {
    return NextResponse.json({ ok: false, reason: "already_private" });
  }
  const dest = await db.organization.findFirst({
    where: {
      ownerId: source.ownerId,
      name: `${swOrgName}-p`,
      agentDomainTier: "private",
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, trmmClientId: true, trmmSiteId: true },
  });
  if (!dest) {
    return NextResponse.json({ ok: false, reason: "no_private_org" });
  }
  if (!dest.trmmSiteId) {
    return NextResponse.json({ ok: false, reason: "private_org_not_provisioned" });
  }
  try {
    // Supersede any live auto-move row so nothing ever races the manual flow.
    await cancelPendingAutoMoveForManualMove(agentId, source.id);
    // The install command for the PRIVATE companion org — the manual
    // installer bakes the private API base into the agent config, which is
    // what enrolls the device under `sw-<uid>-p`. Nothing is executed here.
    const manual = await createManualInstaller({
      clientId: dest.trmmClientId ?? -1,
      siteId: dest.trmmSiteId,
      expiryHours: 72,
      agentType: "workstation",
      goarch: "amd64",
      apiBase: env.trmmPrivateApiBaseUrl,
    });
    return NextResponse.json({
      ok: true,
      flow: "install_verify_remove",
      destinationOrgId: dest.id,
      destinationOrgName: dest.name,
      steps: ["install", "verify", "remove"],
      // TASK_235 — ship BOTH variants. `command` stays the multiline original
      // (byte-shape unchanged for every existing reader); `singleLine` is the
      // relay-safe sibling: `; `-joined, no `$var =` assignments, so it
      // survives a paste into PowerShell AND the mesh terminal relay as ONE
      // statement (multiline fragments execute out of order over the relay —
      // `$exe`/`$agent` null, live-proven 2026-10-20). SW shows this one first.
      install: { command: manual.psCommand, singleLine: manual.psSingleLine },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    return NextResponse.json({ ok: false, reason: message.slice(0, 200) });
  }
}
