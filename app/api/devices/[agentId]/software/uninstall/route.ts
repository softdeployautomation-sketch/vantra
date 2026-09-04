import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { uninstallSoftware } from "@/lib/trmm";

const uninstallSchema = z.object({
  name: z.string().trim().min(1),
  command: z.string().trim().min(1),
  // Cap at 90s to match the existing Terminal panel / cmd route convention.
  timeout: z.number().int().min(1).max(90).default(60),
  runAsUser: z.boolean().default(false),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  let parsed;
  try {
    parsed = uninstallSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    await uninstallSoftware(agentId, {
      name: parsed.name,
      command: parsed.command,
      timeout: parsed.timeout,
      runAsUser: parsed.runAsUser,
    });
    return NextResponse.json({
      ok: true,
      message: `Uninstall of ${parsed.name} started.`,
    });
  } catch (err) {
    console.error("uninstallSoftware failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/software/uninstall",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't uninstall that application right now." },
      { status: 502 },
    );
  }
}