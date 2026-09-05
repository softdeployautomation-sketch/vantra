import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { controlWindowsService, isAgentUnreachableError } from "@/lib/trmm";

const actionSchema = z.object({
  action: z.enum(["start", "stop", "restart"]),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string; serviceName: string }> },
) {
  const { agentId, serviceName } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  let parsed;
  try {
    parsed = actionSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    await controlWindowsService(agentId, serviceName, parsed.action);
    return NextResponse.json({
      ok: true,
      message: `${serviceName} ${parsed.action} sent.`,
    });
  } catch (err) {
    // Sanitize guard rejects names with quotes/backtick/$/; — that's a 400, not a 500
    // (the caller's fault, not the server's).
    if (err instanceof Error && err.message === "Invalid service name.") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("controlWindowsService failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/services/[serviceName]",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't control that service right now." },
      { status: 502 },
    );
  }
}