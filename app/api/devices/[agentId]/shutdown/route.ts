import { NextResponse } from "next/server";

import { authorizePremiumDeviceAction } from "@/lib/agent-route";
import { shutdownAgent } from "@/lib/trmm";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumDeviceAction(agentId);
  if ("response" in result) return result.response;

  try {
    // Any 2xx is success (body unverified) — see lib/trmm.ts trmmPostOk.
    await shutdownAgent(agentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("shutdownAgent failed:", err);
    return NextResponse.json(
      { error: "Couldn't send the shutdown command right now." },
      { status: 502 },
    );
  }
}