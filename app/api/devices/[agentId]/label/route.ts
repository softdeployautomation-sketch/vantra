import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAgentAction } from "@/lib/agent-route";
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

  // Scoping this by the CALLER's active org is only correct for a non-staff
  // owner acting on their own device (authorizeAgentAction's ownership check
  // guarantees agentId really belongs to that org). Staff bypass ownership
  // entirely and could be acting on a different customer's device — there's
  // no reverse lookup yet from agentId back to ITS owning org (same open gap
  // as PLAN_PRIVATE_TECHNICIAN_SESSION.md), so a staff caller here would
  // silently write the label under their OWN org instead, where the actual
  // customer would never see it. Scope this to non-staff until that lookup
  // exists, rather than ship a rename that silently goes to the wrong org.
  if (result.user.isStaff) {
    return NextResponse.json(
      { error: "Renaming isn't available for staff yet — the customer can rename their own device." },
      { status: 403 },
    );
  }
  const org = await getActiveOrganization(result.user);
  if (!org) {
    return NextResponse.json({ error: "No active organization." }, { status: 409 });
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
