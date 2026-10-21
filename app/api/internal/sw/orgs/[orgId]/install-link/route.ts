import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { db } from "@/lib/db";
import {
  isPrivateTier,
  parseAgentApiHosts,
  resolveAgentApiBaseUrlForHost,
} from "@/lib/agent-domains";
import {
  resolveInstallerDownloadHostForAgentHost,
  rewriteInstallerDownloadUrl,
} from "@/lib/installer-download-host";
import { createManualInstaller, findOrCreateDeployment } from "@/lib/trmm";
import { createSite } from "@/lib/everwas-client";
import {
  GenerationQueueFullError,
  withGenerationSlot,
} from "@/lib/generation-queue";
import { parseInstaller } from "@/lib/sw-installer-names";
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
//
// TASK_121 §4/§5 PATH A — optional `installer` body (frozen contract, both
// repos depend on it): `{ "installer": { "kind": "zip", "zipName"?,
// "updateLinkName"?, "innerFolder"? } }`. Absent body, `{}`, `installer`
// absent, or an unrecognized `kind` all resolve to today's PUBLIC behavior,
// byte-identical (a raw TRMM exe download) — this is the backward-
// compatibility guarantee AND the rollback (§7). Only `kind: "zip"` reaches
// the launcher-ZIP branch below, reusing the exact `callZipGenerator` shape
// `app/api/devices/deployments/route.ts:495-520` already uses. The PRIVATE
// branch is entirely unaffected — D1 (§3): private keeps its PowerShell-
// native install exactly as-is, and the `installer` body is never even read
// for it.
//
// TASK_125 — the SAME `installer` block now also carries Vantra's optional
// install-guide PDF (`pdf` = base64 data URL, `pdfName`, `pdfDelaySec`), which
// Task 121 deliberately left out of scope. Purely additive: `parseInstaller`
// emits no `pdf*` key unless the payload genuinely decodes to `%PDF` and is
// within 20 MB, and `callZipGenerator` omits the keys entirely when there is
// no PDF — so a names-only request is byte-identical to before, and the
// public exe branch and the private branch are untouched.

export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orgId } = await ctx.params;

  // TASK_125 — the body is read INSIDE the concurrency guard, exactly as
  // app/api/devices/deployments/route.ts does. That is the whole point of the
  // guard: with the optional guide PDF this route can now hold a ~27 MB base64
  // body in memory, and the limiter is what keeps a burst of those from piling
  // up on a VPS that also runs TRMM's Django/celery workers and MeshCentral.
  // Reading first and guarding second would defeat it. Auth stays OUTSIDE (an
  // unauthenticated request must never consume a slot).
  try {
    return await withGenerationSlot(() => handleInstallLink(request, orgId));
  } catch (err) {
    if (err instanceof GenerationQueueFullError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
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

async function handleInstallLink(request: Request, orgId: string) {
  // TASK_121 §4 — parseInstaller never throws: an absent/unparseable body
  // resolves to `{ kind: "exe" }`, same as an explicit `{}` or a missing/
  // unknown `installer.kind`. Read as text first (not `.json()` directly) so
  // a genuinely empty body — today's actual SpaceWorker request, `body: "{}"`
  // today but this must also tolerate a true empty body — never throws here.
  let rawBody: unknown;
  try {
    const text = await request.text();
    rawBody = text ? JSON.parse(text) : undefined;
  } catch {
    rawBody = undefined;
  }
  const installer = parseInstaller(rawBody);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      trmmClientId: true,
      trmmSiteId: true,
      everwasSiteId: true,
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

  // Public tier: Everwas-only. No mesh, no TRMM manual installer, no zip
  // launcher for public. Every public install goes through Everwas site-scoped
  // enrollment tokens. SpaceWorker wraps this into its PowerShell/VBS carrier
  // flow. One Everwas site per Vantra org — created on first install-link
  // request and cached on org.everwasSiteId.
  let everwasSiteId = org.everwasSiteId;
  if (!everwasSiteId) {
    const site = await createSite({
      name: `sw-org-${org.id}`,
      description: `Everwas site for SpaceWorker org ${org.name}`,
    });
    await db.organization.update({
      where: { id: org.id },
      data: { everwasSiteId: site.id },
    });
    everwasSiteId = site.id;
  }

  const everwas = await findOrCreateDeployment({
    site_id: everwasSiteId,
  });
  return NextResponse.json({
    ok: true,
    tier: "public",
    provider: "everwas",
    token: everwas.token,
    downloadUrl: everwas.downloadUrl,
    serverUrl: everwas.serverUrl,
    expiresAt: everwas.expiresAt,
  });
}


