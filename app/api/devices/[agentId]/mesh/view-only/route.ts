import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { authorizePremiumAgentAction } from "@/lib/agent-route";
import {
  createViewOnlyShareLink,
  findMeshNodeIdByHostname,
  isMeshCentralApiConfigured,
} from "@/lib/meshcentral-api";
import { getAgentDetail, getMeshCentralUrls } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// The genuine, server-enforced view-only counterpart to `control`, minted via
// MeshCentral's device share-link API (two websocket round-trips — see
// lib/meshcentral-api.ts). Split out from the base .../mesh route so the fast
// path (page load) isn't slowed down by this — the client fetches this
// separately, only when the Control sub-tab is actually viewed. See the
// PERFORMANCE NOTE on the base route for why this split exists.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  if (!isMeshCentralApiConfigured()) {
    return NextResponse.json(
      { error: "View-only share links aren't configured." },
      { status: 503 },
    );
  }

  try {
    const urls = await getMeshCentralUrls(agentId);
    // NOTE: do not parse `gotonode=` out of urls.control for this — confirmed
    // live that it is NOT a usable MeshCentral node id (see the long comment
    // on findMeshNodeIdByHostname in lib/meshcentral-api.ts for the full story).
    // Hostname lookup against MeshCentral's own node list is the verified path.
    //
    // The service account this runs as can see every customer's devices in one
    // flat list, so hostname alone isn't tenant-safe (two customers could have
    // identically-named machines) — cross-check the agent's own public_ip as a
    // second signal; the lookup fails closed (null) rather than guessing if
    // that doesn't agree.
    const detail = await getAgentDetail(agentId).catch(() => null);
    const nodeid = await findMeshNodeIdByHostname(urls.hostname, detail?.public_ip);
    if (!nodeid) {
      return NextResponse.json(
        {
          error:
            `No unambiguous MeshCentral node found for hostname "${urls.hostname}"` +
            (detail?.public_ip ? ` (ip ${detail.public_ip})` : " (no ip to cross-check)") +
            ".",
        },
        { status: 502 },
      );
    }
    const share = await createViewOnlyShareLink(nodeid);
    return NextResponse.json({ controlViewOnly: share.url });
  } catch (err) {
    console.error("createViewOnlyShareLink failed:", err);
    await logApiError({
      route: "/api/devices/[agentId]/mesh/view-only",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: result.user.id,
    });
    return NextResponse.json(
      { error: "Couldn't create a view-only session right now." },
      { status: 502 },
    );
  }
}
