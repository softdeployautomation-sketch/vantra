import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizePremiumStaffAgentAction } from "@/lib/agent-route";
import { db } from "@/lib/db";

// Task 18 — queue a command to run the next time an offline device comes back
// online (triggered by the online transition, not a calendar-time scheduler).
// Same auth/ownership posture as the live cmd route (authorizePremiumAgentAction
// = premium plan + agent belongs to the caller's own active org client, IDOR
// guard). GET lists the caller's own queued commands for this agent so the UI
// never shows another user's commands; POST creates one.

const queueCmdSchema = z.object({
  cmd: z.string().min(1).max(8000),
  shell: z.enum(["cmd", "powershell"]).default("cmd"),
  // Same ceiling as the live cmd route (90s) so a queued command can never
  // outrun what a real-time run would allow when it finally fires.
  timeout: z.number().int().min(1).max(90).default(30),
  runAsUser: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;

  const commands = await db.queuedAgentCommand.findMany({
    where: { agentId, userId: result.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shell: true,
      cmd: true,
      timeoutSeconds: true,
      runAsUser: true,
      status: true,
      createdAt: true,
      sentAt: true,
      error: true,
    },
  });
  return NextResponse.json({ commands });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;

  let parsed;
  try {
    parsed = queueCmdSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const created = await db.queuedAgentCommand.create({
    data: {
      agentId,
      userId: result.user.id,
      shell: parsed.shell,
      cmd: parsed.cmd,
      timeoutSeconds: parsed.timeout,
      runAsUser: parsed.runAsUser,
    },
    select: {
      id: true,
      shell: true,
      cmd: true,
      timeoutSeconds: true,
      runAsUser: true,
      status: true,
      createdAt: true,
      error: true,
    },
  });
  return NextResponse.json({ command: created }, { status: 201 });
}