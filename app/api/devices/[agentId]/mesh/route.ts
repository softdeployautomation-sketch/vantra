import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumAgentAction } from "@/lib/agent-route";
import { getMeshCentralUrls } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// PERFORMANCE NOTE (regression found + fixed 2026-09-03): this route used to
// also mint the view-only share link inline (two serial MeshCentral websocket
// round-trips: one to list nodes, one to create the share link). That was
// written assuming it only ran "on Remote Tools open, not a hot path" — wrong.
// components/tabs.tsx mounts EVERY tab's content immediately (by design, so
// switching tabs doesn't reload the MeshCentral iframe), so RemoteTools's
// effect — and therefore this fetch — fires the moment the device detail page
// loads, regardless of which tab is active. Adding ~2 websocket round-trips to
// that made every device-detail page load slow, not just Remote Tools usage.
// Fix: this route stays fast (one TRMM call, as it always was) and the
// view-only link is minted lazily by GET .../mesh/view-only instead, fetched
// by the client only once the Control sub-tab is actually viewed.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const urls = await getMeshCentralUrls(agentId);
    return NextResponse.json({ urls });
  } catch (err) {
    console.error("getMeshCentralUrls failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/mesh",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't fetch remote-access details right now." },
      { status: 502 },
    );
  }
}