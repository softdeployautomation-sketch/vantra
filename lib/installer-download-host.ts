// Task 74 — public/private installer download host split.
//
// The agent's own check-in host (resolveAgentApiBaseUrl) is a SEPARATE concern
// from the installer's own download link. The ZIP/MSI generator mints
// customer-facing download URLs from its own PUBLIC_URL/REDIRECT_BASE_URL
// config — both currently resolve to the PRIVATE host (dl.instaweb.top).
// Public-tier orgs must get the public counterpart (dl.broks.beauty, whose
// nginx vhost mirrors the private one verbatim per Task 66) so bulk/public
// traffic never touches the protected instaweb.top surface.
//
// Two layers (both tier-aware, both reuse isPrivateTier — no re-derived tier
// logic):
//   1. Preferred: pass `downloadHost` per build so the generator itself mints
//      every URL (including hosts baked INSIDE artifacts, e.g. the VBS
//      payload) on the right host.
//   2. Defense-in-depth: rewrite any returned URL whose host is still the
//      private host, so an older generator (or a code path that doesn't take
//      downloadHost) can never leak the private host to a public org.
import "server-only";

import { isPrivateTier } from "./agent-domain-tier";

/** The private download host the generator mints by default today. */
export const PRIVATE_INSTALLER_DOWNLOAD_HOST = "dl.instaweb.top";

/** The public counterpart (Task 66: DNS + nginx, mirrors the private vhost). */
export const PUBLIC_INSTALLER_DOWNLOAD_HOST = "dl.broks.beauty";

/**
 * The customer-facing download origin for an org tier. Public-tier orgs get
 * `https://dl.broks.beauty`; private-tier orgs keep `undefined` (generator
 * default = today's private host, byte-identical). Unknown/missing tiers fail
 * to public — the same "unknown/missing -> public" rule as
 * normalizeAgentDomainTier (the provisioning default), so the download host
 * never disagrees with the agent-domain tier resolution for the same org.
 */
export function resolveInstallerDownloadHost(tier: unknown): string | undefined {
  return isPrivateTier(tier) ? undefined : `https://${PUBLIC_INSTALLER_DOWNLOAD_HOST}`;
}

// --- Task 82: download host follows the CHOSEN agent host's domain family ---
// Owner decision 2026-09-21: the per-install agent host determines the
// customer-facing download host, NOT the org tier:
//   agent.broks.beauty install -> https://dl.broks.beauty
//   agent.instaweb.top install -> dl.instaweb.top (the generator default —
//     return undefined so the generator mints its own, byte-identical URLs)
//   anything else / unknown    -> broks family (provisioning default)
export function resolveInstallerDownloadHostForAgentHost(
  agentHost: string | null | undefined,
): string | undefined {
  const normalized = (agentHost ?? "").trim().toLowerCase();
  return normalized === "agent.broks.beauty" || normalized === ""
    ? `https://${PUBLIC_INSTALLER_DOWNLOAD_HOST}`
    : undefined;
}

/**
 * Rewrite a generator-minted URL onto the org's download host. Only rewrites
 * when the URL parses AND its current host is exactly the private host —
 * anything else (already public, dev/localhost, unparseable, non-download
 * URL) passes through untouched, so this is a no-op for every tier/host
 * combination except the one Task 74 targets.
 *
 * Task 82: an optional `agentHost` narrows the rewrite to the chosen install's
 * family — only broks-family installs get dl.instaweb→dl.broks rewritten; an
 * instaweb-family install's default host IS its correct family host, so the
 * rewrite is a no-op there.
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
  if (typeof url !== "string" || url === "") return url;
  if (isPrivateTier(tier)) return url;
  // Instaweb-family install: the generator default host is already the right
  // family host — never rewrite (and never leak a broks host onto it).
  if ((agentHost ?? "").trim().toLowerCase() === "agent.instaweb.top") return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname.toLowerCase() !== PRIVATE_INSTALLER_DOWNLOAD_HOST) return url;
  parsed.hostname = PUBLIC_INSTALLER_DOWNLOAD_HOST;
  return parsed.toString();
}
