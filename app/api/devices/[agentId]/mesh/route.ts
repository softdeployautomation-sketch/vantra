import { NextResponse } from "next/server";

import { authorizeStaffAction } from "@/lib/agent-route";
import { getMeshCentralUrls } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const result = await authorizeStaffAction();
  if ("response" in result) return result.response;
  const { agentId } = await ctx.params;

  try {
    const urls = await getMeshCentralUrls(agentId);
    return NextResponse.json({ urls });
  } catch (err) {
    console.error("getMeshCentralUrls failed:", err);
    return NextResponse.json(
      { error: "Couldn't fetch remote-access details right now." },
      { status: 502 },
    );
  }
}