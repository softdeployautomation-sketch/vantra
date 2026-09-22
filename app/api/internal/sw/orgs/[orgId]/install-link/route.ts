import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import { parseAgentApiHosts, resolveAgentApiBaseUrlForHost } from "@/lib/agent-domains";
import { createDeployment, deployUrl } from "@/lib/trmm";
import { isSwOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: one-time installer link for a `sw-` org.
// POST /api/internal/sw/orgs/[orgId]/install-link → mints a fresh TRMM
// deployment for the org's site and returns the direct exe download URL (the
// same AllowAny URL the Vantra Add-Device flow hands out). The SpaceWorker
// side stores/labels the link; the agent enrolls into the org's TRMM site
// and shows up in /api/internal/sw/devices.

export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orgId } = await ctx.params;

  try {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        trmmSiteId: true,
        agentDomainTier: true,
        agentApiHosts: true,
      },
    });
    if (!org || !isSwOrgName(org.name)) {
      return NextResponse.json({ error: "Not a SpaceWorker org." }, { status: 404 });
    }
    if (!org.trmmSiteId) {
      return NextResponse.json(
        { error: "Org has no TRMM site provisioned." },
        { status: 502 },
      );
    }

    const deployment = await createDeployment({
      site: org.trmmSiteId,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      agentType: "workstation",
      goarch: "amd64",
    });

    // Task 82 rule: pick the org's FIRST allowed public host for the download
    // base (byte-identical to the Add-Device default-host behavior).
    const hosts = parseAgentApiHosts(org.agentApiHosts, org.agentDomainTier);
    const downloadUrl = deployUrl(
      deployment.uid,
      resolveAgentApiBaseUrlForHost(org.agentDomainTier, hosts[0]),
    );

    return NextResponse.json({ ok: true, downloadUrl, agentApiHost: hosts[0] });
  } catch (err) {
    console.error("sw install-link failed:", err);
    await logApiError({
      route: "/api/internal/sw/orgs/[orgId]/install-link",
      method: "POST",
      statusCode: 502,
      error: err,
    });
    return NextResponse.json({ error: "Couldn't mint an install link." }, { status: 502 });
  }
}