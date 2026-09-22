import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import {
  isPrivateTier,
  parseAgentApiHosts,
  resolveAgentApiBaseUrlForHost,
} from "@/lib/agent-domains";
import { createManualInstaller, createDeployment, deployUrl } from "@/lib/trmm";
import { isSwOrgName } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: one-time installer for a `sw-` org.
// POST /api/internal/sw/orgs/[orgId]/install-link mints a fresh TRMM
// deployment for the org's site. The SpaceWorker side wraps the public-tier
// URL in its own one-time /link/vantra/<token> redirect; the raw TRMM URL is
// never stored client-side.
//
// 2026-10 console follow-up — PUBLIC vs PRIVATE install (the owner tier
// model: public org = the shareable link; private org = premium,
// admin-granted):
//   - Public org  → { ok, tier: "public", downloadUrl }: the SpaceWorker
//     Add-a-device panel shows ONLY its wrapped link path (never the agent
//     host), and the device silently auto-moves to the owner's private org
//     when they have one (Vantra Task 64).
//   - Private org → { ok, tier: "private", command }: a PowerShell-native
//     install command baked against the org's PRIVATE agent API base (Task
//     61 lockout — private is never host-selectable). NO naked download URL
//     is returned for the private tier: a bare installer would enroll the
//     agent against the wrong domain family.

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
        trmmClientId: true,
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

    // Task 82 rule: pick the org's FIRST allowed public host for the base
    // (byte-identical to the Add-Device default-host behavior). Private orgs
    // ignore the allowlist entirely (Task 61 lockout) and resolve to the
    // single private API base.
    const hosts = parseAgentApiHosts(org.agentApiHosts, org.agentDomainTier);
    const apiBase = resolveAgentApiBaseUrlForHost(org.agentDomainTier, hosts[0]);

    if (isPrivateTier(org.agentDomainTier)) {
      // Private: the PowerShell-native install command ONLY. The manual
      // installer bakes the PRIVATE api base into the agent config.
      const manual = await createManualInstaller({
        clientId: org.trmmClientId ?? -1,
        siteId: org.trmmSiteId,
        expiryHours: 72,
        agentType: "workstation",
        goarch: "amd64",
        apiBase,
      });
      return NextResponse.json({
        ok: true,
        tier: "private",
        agentApiHost: hosts[0],
        command: manual.psCommand,
      });
    }

    // Public: direct exe download URL.
    const deployment = await createDeployment({
      site: org.trmmSiteId,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      agentType: "workstation",
      goarch: "amd64",
    });
    return NextResponse.json({
      ok: true,
      tier: "public",
      agentApiHost: hosts[0],
      downloadUrl: deployUrl(deployment.uid, apiBase),
    });
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
