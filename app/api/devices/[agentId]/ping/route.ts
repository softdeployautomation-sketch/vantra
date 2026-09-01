import { NextResponse } from "next/server";

import { authorizeAgentAction } from "@/lib/agent-route";
import { pingAgent } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizeAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const ping = await pingAgent(agentId);
    return NextResponse.json({ ping });
  } catch (err) {
    console.error("pingAgent failed:", err);
    return NextResponse.json(
      { error: "Couldn't ping the device right now." },
      { status: 502 },
    );
  }
}