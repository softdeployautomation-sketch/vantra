import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumDeviceAction } from "@/lib/agent-route";
import { isAgentUnreachableError, shutdownAgent } from "@/lib/trmm";

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
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("shutdownAgent failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/shutdown",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't send the shutdown command right now." },
      { status: 502 },
    );
  }
}