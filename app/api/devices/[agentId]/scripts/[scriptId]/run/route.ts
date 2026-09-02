import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/session-user";
import { canRunScriptOnAgent } from "@/lib/script-authz";
import { runScriptOnAgent } from "@/lib/trmm";

const runSchema = z.object({
  args: z.array(z.string()).max(20).optional(),
  timeout: z.number().int().min(1).max(300).optional(),
  runAsUser: z.boolean().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string; scriptId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  const { agentId, scriptId } = await ctx.params;

  // Script must be the caller's own; agent must be one they may act on. 404 (not
  // 403) so we don't leak existence of either other users' scripts or agents.
  const script = await canRunScriptOnAgent(scriptId, agentId, user);
  if (!script) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let parsed;
  try {
    parsed = runSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const output = await runScriptOnAgent({
      agentId,
      trmmScriptId: script.trmmScriptId,
      args: parsed.args,
      timeout: parsed.timeout,
      runAsUser: parsed.runAsUser,
    });
    return NextResponse.json({ output });
  } catch (err) {
    console.error("runScriptOnAgent failed:", err);
    return NextResponse.json(
      { error: "The script failed or timed out." },
      { status: 502 },
    );
  }
}