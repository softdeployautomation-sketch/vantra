import { NextResponse } from "next/server";

import { authorizePremiumStaffAgentAction } from "@/lib/agent-route";
import { db } from "@/lib/db";

// Task 25 — non-sensitive read of the stored credential for THIS device. Returns
// only metadata (has it, PIN length, platform, when updated) + the latest request
// lifecycle status. It NEVER returns the decrypted value — that only happens via
// the separate, audited .../reveal endpoint. Both are staff-only and
// device-authorization-gated (authorizePremiumStaffAgentAction re-checks the
// caller may manage THIS agentId on every request).

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumStaffAgentAction(agentId);
  if ("response" in result) return result.response;

  const stored = await db.deviceCredential.findUnique({
    where: { agentId },
    select: {
      pinLength: true,
      platform: true,
      username: true,
      updatedAt: true,
      requestId: true,
    },
  });

  const latestRequest = await db.deviceCredentialRequest.findFirst({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, pinLength: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({
    hasCredential: !!stored,
    pinLength: stored?.pinLength ?? null,
    platform: stored?.platform ?? "windows",
    username: stored?.username ?? null,
    updatedAt: stored?.updatedAt ?? null,
    storedRequestId: stored?.requestId ?? null,
    latestRequest,
  });
}
