import { NextResponse } from "next/server";

import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { listWindowsServices } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const services = await listWindowsServices(agentId);
    return NextResponse.json({ services });
  } catch (err) {
    console.error("listWindowsServices failed:", err);
    return NextResponse.json(
      { error: "Couldn't list services right now." },
      { status: 502 },
    );
  }
}