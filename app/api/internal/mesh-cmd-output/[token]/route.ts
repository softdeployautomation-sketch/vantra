import { NextResponse } from "next/server";

import { resolveCmdOutputSink } from "@/lib/mesh-cmd-output";

export const dynamic = "force-dynamic";

// TASK_234 — PUBLIC ingest: the customer's mesh agent POSTs captured command
// output here (the `runcommands` wire never returns output — see
// lib/mesh-cmd-output.ts header). Auth IS the capability token: 192 random
// bits, one-shot, TTL'd. Wrong/unknown/expired → 404 (never confirm anything).
// Worst case of token compromise: text lands in the output pane of the very
// command the token was minted for. No state change, no read.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{48}$/.test(token)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const body = await request.text().catch(() => "");
  if (!resolveCmdOutputSink(token, body)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
