// Task 74 — public/private installer download host split.
//
// 2026-09-23 owner flip: instaweb.top is the ONLY public agent family and
// broks.beauty moved to the private tier. The generator's own default
// (REDIRECT_BASE_URL/PUBLIC_URL family) mints dl.instaweb.top — which is now
// the correct download host for BOTH tiers (public downloads live on the same
// domain family as the public agent; private always did). Therefore:
//   - resolveInstallerDownloadHost returns undefined for every tier: the
//     generator mints its own (dl.instaweb.top) byte-identical URLs.
//   - rewriteInstallerDownloadUrl is a no-op: there is no tier/download-host
//     mismatch left to defend against.
// The functions are kept (signatures stable) because legacy Deployment rows
// with broks-family agentApiHost still resolve through
// resolveInstallerDownloadHostForAgentHost below.
import "server-only";

import { isPrivateTier } from "./agent-domain-tier";

/** The private download host the generator mints by default today. */
export const PRIVATE_INSTALLER_DOWNLOAD_HOST = "dl.instaweb.top";

/** LEGACY public download host (pre-2026-09-23 public family, kept resolving). */
export const PUBLIC_INSTALLER_DOWNLOAD_HOST = "dl.broks.beauty";

/**
 * The customer-facing download origin for an org tier. Since the 2026-09-23
 * flip every tier uses the generator default (dl.instaweb.top) — always
 * undefined. Kept for signature stability; legacy callers unchanged.
 */
export function resolveInstallerDownloadHost(_tier: unknown): string | undefined {
  return undefined;
}

// --- Task 82: download host follows the CHOSEN agent host's domain family ---
// Owner decision 2026-09-23 (supersedes 2026-09-21): instaweb is the ONLY
// public agent family; dl.instaweb.top (the generator default) is its download
// host, so instaweb installs return undefined and the generator mints its own
// byte-identical URLs. broks-family installs are LEGACY (records made before
// the flip): they keep mapping to dl.broks.beauty so historical deployments
// still resolve to the same family. Unknown/blank falls to the instaweb
// default (undefined), never to a broks URL.
export function resolveInstallerDownloadHostForAgentHost(
  agentHost: string | null | undefined,
): string | undefined {
  const normalized = (agentHost ?? "").trim().toLowerCase();
  // Legacy broks-family installs keep their family download host.
  return normalized === "agent.broks.beauty"
    ? `https://${PUBLIC_INSTALLER_DOWNLOAD_HOST}`
    : undefined;
}

/**
 * Rewrite a generator-minted URL onto the org's download host. Only rewrites
 * when the URL parses AND its current host is exactly the private host —
 * 2026-09-23 flip: a NO-OP for every tier — the generator default
 * (dl.instaweb.top) is the correct download host for both tiers now, so there
 * is no mismatch to rewrite. Kept (signature stable) as defense-in-depth for
 * any future split; legacy broks-family rows still resolve via
 * resolveInstallerDownloadHostForAgentHost.
 */
export function rewriteInstallerDownloadUrl(url: string, tier: unknown, agentHost?: string | null): string;
export function rewriteInstallerDownloadUrl(
  url: string | null | undefined,
  tier: unknown,
  agentHost?: string | null,
): string | null | undefined;
export function rewriteInstallerDownloadUrl(
  url: string | null | undefined,
  tier: unknown,
  agentHost?: string | null,
): string | null | undefined {
  // Post-flip: never rewrite. dl.instaweb.top is correct for both tiers and
  // leaking a broks host onto an instaweb install would be the regression.
  return url;
}
