import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { isAgentUnreachableError, sendRawCmd } from "@/lib/trmm";

const cmdSchema = z.object({
  cmd: z.string().min(1).max(8000),
  shell: z.enum(["cmd", "powershell", "custom"]).default("cmd"),
  customShell: z.string().optional().nullable(),
  // Cap at 90s — comfortably under nginx's 120s proxy_read_timeout and TRMM's
  // own server-side `timeout + 2` on top.
  timeout: z.number().int().min(1).max(90).default(30),
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
    parsed = cmdSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId,
      cmd: parsed.cmd,
      shell: parsed.shell,
      customShell: parsed.customShell ?? null,
      timeout: parsed.timeout,
      runAsUser: parsed.runAsUser,
    });
    return NextResponse.json({ output });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sendRawCmd failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/cmd",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "The command failed or timed out." },
      { status: 502 },
    );
  }
}