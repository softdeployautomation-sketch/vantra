import { NextResponse } from "next/server";

import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { db } from "@/lib/db";

// Task 18 — cancel a still-queued command before it fires. Ownership enforced
// twice: authorizePremiumAgentAction gates the agent to the caller's own org
// client, and the row must be keyed by this same user (userId) — a queued
// command can never be cancelled across users/orgs. Only a still-"queued" row
// can be cancelled; one that already fired (sent) is immutable and reported
// as 409 rather than silently pretending the cancel succeeded.

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ agentId: string; queueId: string }> },
) {
  const { agentId, queueId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  const row = await db.queuedAgentCommand.findUnique({
    where: { id: queueId, agentId, userId: result.user.id },
  });
  if (!row) {
    // 404 (not 403) so we never leak whether a queueId we don't own exists.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (row.status !== "queued") {
    return NextResponse.json(
      {
        error:
          row.status === "sent"
            ? "This command was already sent and can no longer be cancelled."
            : "This command can no longer be cancelled.",
      },
      { status: 409 },
    );
  }

  await db.queuedAgentCommand.update({
    where: { id: queueId },
    data: { status: "cancelled" },
  });
  return NextResponse.json({ ok: true });
}