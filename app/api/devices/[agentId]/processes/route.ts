import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizeAgentAction } from "@/lib/agent-route";
import { listAgentProcesses } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  // READ is free-tier (ownership-checked) so the Overview "at a glance" strip
  // and a top-level Task Manager tab can preview processes without Premium.
  // KILL (DELETE) below stays Premium-gated.
  const result = await authorizeAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const processes = await listAgentProcesses(agentId);
    return NextResponse.json({ processes });
  } catch (err) {
    console.error("listAgentProcesses failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/processes",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't list processes right now." },
      { status: 502 },
    );
  }
}