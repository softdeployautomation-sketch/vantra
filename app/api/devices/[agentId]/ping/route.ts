import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumDeviceAction } from "@/lib/agent-route";
import { isAgentUnreachableError, pingAgent } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;

  const result = await authorizePremiumDeviceAction(agentId);
  if ("response" in result) return result.response;

  try {
    const ping = await pingAgent(agentId);
    return NextResponse.json({ ping });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      // Pinging an offline device and finding out it's offline is the ping
      // working correctly, not a failure — same response shape either way.
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("pingAgent failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/ping",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't ping the device right now." },
      { status: 502 },
    );
  }
}