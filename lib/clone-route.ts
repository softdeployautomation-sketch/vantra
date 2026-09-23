import "server-only";

import { NextResponse } from "next/server";

import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { isAgentUnreachableError } from "@/lib/trmm";

// TASK_108 (bit B2) — shared shape for the seven clone/relay routes. Every
// route: verifySwSecret → 401; assertAgentInSwOrg → 404 (never 403); zod
// body → 400; offline agent → 503; anything else → 502. Nothing here touches
// TRMM directly — each route calls sendRawCmd once with a builder from
// lib/clone-engine-cmds.ts and parses the TEXT back with lib/clone-engine-parse.ts.
export type CloneRouteContext = { params: Promise<{ agentId: string }> };

export async function cloneAuth(
  request: Request,
  ctx: CloneRouteContext,
): Promise<{ agentId: string } | NextResponse> {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;
  const orgName = await assertAgentInSwOrg(agentId);
  if (!orgName) {
    // 404 (not 403) so a prober can't even confirm the agent exists.
    return NextResponse.json({ error: "Device not found." }, { status: 404 });
  }
  return { agentId };
}

export function cloneErr(err: unknown, fallback: string): NextResponse {
  if (isAgentUnreachableError(err)) {
    return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
  }
  console.error(`sw ${fallback} failed:`, err);
  return NextResponse.json({ error: `${fallback} failed.` }, { status: 502 });
}
