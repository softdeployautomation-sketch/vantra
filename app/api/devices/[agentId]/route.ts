import { NextResponse } from "next/server";

import { canAccessAgent } from "@/lib/authz";
import { getCurrentUser } from "@/lib/session-user";
import { getAgentDetail } from "@/lib/trmm";

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

  // IDOR guard: staff bypass, customers only their own client's agent. 404 (not
  // 403) so we don't leak whether another customer's agent exists.
  const allowed = await canAccessAgent(agentId, user);
  if (!allowed) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const agent = await getAgentDetail(agentId);
    return NextResponse.json({ agent });
  } catch (err) {
    console.error("getAgentDetail failed:", err);
    return NextResponse.json(
      { error: "Couldn't load device details right now." },
      { status: 502 },
    );
  }
}