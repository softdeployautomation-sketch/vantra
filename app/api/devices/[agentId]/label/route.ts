import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAgentAction } from "@/lib/agent-route";
import { assertAgentBelongsToClient } from "@/lib/authz";
import { getActiveOrganization } from "@/lib/session-user";
import { db } from "@/lib/db";

// PATCH /api/devices/[agentId]/label — set/clear this device's customer-facing
// nickname. Free-tier (ownership-checked only, no Premium gate) — renaming
// your own device to something memorable is basic device management, same
// posture as the free-tier device list/status reads.
const bodySchema = z.object({
  label: z.string().trim().max(60),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizeAgentAction(agentId);
  if ("response" in result) return result.response;

  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // authorizeAgentAction's staff bypass grants access to ANY device
  // regardless of org — but scoping the DeviceLabel write by the CALLER's
  // own active org is only correct when the device genuinely belongs to
  // that org. Re-check real ownership here explicitly (ignoring isStaff)
  // rather than trusting the bypass: if this agent actually belongs to the
  // caller's own active org (the common case — most staff accounts in this
  // app are also an org owner viewing their own devices), renaming is fine.
  // Only a TRUE cross-tenant case (staff acting on a different customer's
  // device, which the bypass also allows) is blocked, since there's no
  // reverse lookup yet from agentId back to ITS actual owning org to scope
  // the write correctly (same open gap as PLAN_PRIVATE_TECHNICIAN_SESSION.md).
  const org = await getActiveOrganization(result.user);
  if (!org) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
  }
  if (result.user.isStaff) {
    const ownedByActiveOrg = await assertAgentBelongsToClient(agentId, org.trmmClientId);
    if (!ownedByActiveOrg) {
      return NextResponse.json(
        { error: "Renaming another customer's device isn't available for staff yet." },
        { status: 403 },
      );
    }
  }

  const label = parsed.label.trim();
  if (label === "") {
    // Empty label means "clear it, go back to the TRMM site-name fallback."
    await db.deviceLabel.deleteMany({ where: { organizationId: org.id, agentId } });
    return NextResponse.json({ label: null });
  }

  await db.deviceLabel.upsert({
    where: { organizationId_agentId: { organizationId: org.id, agentId } },
    update: { label },
    create: { organizationId: org.id, agentId, label },
  });

  return NextResponse.json({ label });
}
