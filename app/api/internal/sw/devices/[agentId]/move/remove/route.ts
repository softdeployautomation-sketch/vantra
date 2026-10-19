import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { deleteAgent, getAgentDetail, isAgentUnreachableError, listAgents } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// TASK_230 A.4 — step 3 (REMOVE) of install→verify→remove.
// POST /api/internal/sw/devices/[agentId]/move/remove
//
// Deletes the OLD public-tier agent record once the device is confirmed live
// under the private companion org. The verify check is re-run HERE
// server-side (same logic as ./verify) — the ordering install→verify→remove is
// ENFORCED, not merely documented: this route refuses while the private org
// has no agent matching the old record's hostname, so a caller (or a bug in
// the client) can never delete the public record before the device has
// re-enrolled privately. Worst case of a race remains recoverable: the old
// record deletion is last, and if verify never flips, nothing is deleted.
//
// The removal is TRMM record cleanup only — no command is sent to the device.
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
    select: { id: true, trmmClientId: true },
  });
  if (!dest) {
    return NextResponse.json({ ok: false, reason: "no_private_org" });
  }
  try {
    // Ordering enforcement — the same hostname check as ./verify, re-run
    // HERE so install→verify→remove is server-enforced, not caller-hoped.
    const old = await getAgentDetail(agentId).catch(() => null);
    if (!old?.hostname) {
      return NextResponse.json({
        ok: false,
        reason: old ? "old_agent_hostname_unavailable" : "old_agent_not_found",
      });
    }
    if (!dest.trmmClientId) {
      return NextResponse.json({ ok: false, reason: "private_org_not_provisioned" });
    }
    const privateAgents = await listAgents(dest.trmmClientId);
    const verified = privateAgents.some(
      (a) => a.hostname.toLowerCase() === old.hostname.toLowerCase(),
    );
    if (!verified) {
      return NextResponse.json({
        ok: false,
        reason: "not_verified_install_first",
      });
    }
    await deleteAgent(agentId);
    return NextResponse.json({ ok: true, removed: true });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json(
        { ok: false, reason: "trmm_unreachable" },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : String(err ?? "");
    return NextResponse.json({ ok: false, reason: message.slice(0, 200) });
  }
}
