import { NextResponse } from "next/server";

import { authorizePremiumAgentAction } from "@/lib/agent-route";
import {
  createViewOnlyShareLink,
  findMeshNodeIdByHostname,
  isMeshCentralApiConfigured,
} from "@/lib/meshcentral-api";
import { getMeshCentralUrls } from "@/lib/trmm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await ctx.params;
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result.response;

  try {
    const urls = await getMeshCentralUrls(agentId);

    // controlViewOnly is the genuine, server-enforced view-only counterpart to
    // `control`, minted via MeshCentral's device share-link API. It is OPTIONAL:
    // if the integration isn't configured (or the minting call fails), we simply
    // omit it and the UI falls back to the client-side soft "arm before input"
    // guard. MeshCentral has no per-URL viewonly flag, so this is the only way
    // real input-blocking is possible.
    const urlsWithViewOnly = { ...urls };
    try {
      if (isMeshCentralApiConfigured()) {
        // NOTE: do not parse `gotonode=` out of urls.control for this — confirmed
        // live that it is NOT a usable MeshCentral node id (see the long comment
        // on findMeshNodeIdByHostname in lib/meshcentral-api.ts for the full story).
        // Hostname lookup against MeshCentral's own node list is the verified path.
        const nodeid = await findMeshNodeIdByHostname(urls.hostname);
        if (!nodeid) {
          throw new Error(`No MeshCentral node found for hostname "${urls.hostname}".`);
        }
        const share = await createViewOnlyShareLink(nodeid);
        urlsWithViewOnly.controlViewOnly = share.url;
      }
    } catch (err) {
      // Degrade silently — the toggle still works via the soft guard. Don't 502
      // the whole Remote Tools card just because view-only minting failed.
      console.error("createViewOnlyShareLink failed:", err);
    }

    return NextResponse.json({ urls: urlsWithViewOnly });
  } catch (err) {
    console.error("getMeshCentralUrls failed:", err);
    return NextResponse.json(
      { error: "Couldn't fetch remote-access details right now." },
      { status: 502 },
    );
  }
}