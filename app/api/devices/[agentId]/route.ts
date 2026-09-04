import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizeAgentAction } from "@/lib/agent-route";
import { canAccessAgent } from "@/lib/authz";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { deleteAgent, getAgentDetail } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { agentId } = await ctx.params;

  // IDOR guard: staff bypass, customers only their active org's client's agent.
  // 404 (not 403) so we don't leak whether another customer's agent exists.
  const org = await getActiveOrganization(user);
  const allowed = await canAccessAgent(agentId, {
    isStaff: user.isStaff,
    trmmClientId: org?.trmmClientId ?? null,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const agent = await getAgentDetail(agentId);
    return NextResponse.json({ agent });
  } catch (err) {
    console.error("getAgentDetail failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't load device details right now." },
      { status: 502 },
    );
  }
}

// One irreversible TRMM action: uninstalls the agent software AND deletes the
// device record in the same call (see lib/trmm.ts deleteAgent). Not premium-gated —
// removing your own broken/decommissioned device is basic device management.
// Uses the same authorizeAgentAction guard as reboot/shutdown (staff bypass +
// ownership, 404 for non-owners).
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizeAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    await deleteAgent(agentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteAgent failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]",
      method: "DELETE",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't delete this device right now." },
      { status: 502 },
    );
  }
}