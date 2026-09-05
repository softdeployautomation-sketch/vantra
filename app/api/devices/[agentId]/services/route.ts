import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizeAgentAction } from "@/lib/agent-route";
import { isAgentUnreachableError, listWindowsServices } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  // READ is free-tier (ownership-checked) so Overview's "at a glance" strip and
  // a top-level Services tab can preview services without Premium. Service
  // CONTROL (POST /services/{name}) stays Premium-gated in its own route.
  const result = await authorizeAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const services = await listWindowsServices(agentId);
    return NextResponse.json({ services });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("listWindowsServices failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/services",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't list services right now." },
      { status: 502 },
    );
  }
}