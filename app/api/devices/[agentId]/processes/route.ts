import { NextResponse } from "next/server";

import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { listAgentProcesses } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const processes = await listAgentProcesses(agentId);
    return NextResponse.json({ processes });
  } catch (err) {
    console.error("listAgentProcesses failed:", err);
    return NextResponse.json(
      { error: "Couldn't list processes right now." },
      { status: 502 },
    );
  }
}