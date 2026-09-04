import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { killAgentProcess } from "@/lib/trmm";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ agentId: string; pid: string }> },
) {
  const { agentId, pid } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  // Validate the pid path segment is a positive integer before forwarding it —
  // never send garbage to TRMM (rejects non-numeric with 400, not a crash).
  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0) {
    return NextResponse.json({ error: "Invalid process id." }, { status: 400 });
  }

  try {
    await killAgentProcess(agentId, pidNum);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("killAgentProcess failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/processes/[pid]",
      method: "DELETE",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't end that process right now." },
      { status: 502 },
    );
  }
}