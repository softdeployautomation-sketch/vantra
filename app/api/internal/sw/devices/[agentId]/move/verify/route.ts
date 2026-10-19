import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { getAgentDetail, isAgentUnreachableError, listAgents } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// TASK_230 A.4 — step 2 of install→verify→remove.
// POST /api/internal/sw/devices/[agentId]/move/verify
//
// After the user runs the private-tier install command on the device (step 1,
// /move), the SAME physical machine re-enrolls under the private companion
// org `sw-<uid>-p` as a NEW agent. Verify answers: "has the device shown up
// under the private org yet?" — by hostname match of the private client's
// agent list against the old public agent's hostname. Read-only: no device
// state is touched. The client (and move/remove, which calls this same check
// server-side) polls it until it flips true.
//
// Hostname caveats (documented, fail-open on ambiguity):
//   - two machines could share a hostname; matching is scoped to the private
//     client's own list, so cross-tenant collision can't happen;
//   - the matched private agent is returned so the caller can eyeball it.
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
    const old = await getAgentDetail(agentId).catch(() => null);
    if (!old?.hostname) {
      // Old record already gone (user removed it manually) or TRMM can't
      // tell us its hostname — can't match without a name.
      return NextResponse.json({
        ok: true,
        verified: false,
        reason: old ? "old_agent_hostname_unavailable" : "old_agent_not_found",
      });
    }
    if (!dest.trmmClientId) {
      return NextResponse.json({ ok: false, reason: "private_org_not_provisioned" });
    }
    const privateAgents = await listAgents(dest.trmmClientId);
    const match = privateAgents.find(
      (a) => a.hostname.toLowerCase() === old.hostname.toLowerCase(),
    );
    return NextResponse.json({
      ok: true,
      verified: Boolean(match),
      ...(match
        ? { privateAgentId: match.agent_id, hostname: match.hostname }
        : {}),
    });
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
