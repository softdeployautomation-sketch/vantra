import "server-only";

import { env } from "./env";
import { isPrivateTier } from "./agent-domain-tier";

// Task 61 (Task 53 Part 1/3): per-org agent-domain resolution. A public-tier
// org's installers point at TRMM_PUBLIC_API_BASE_URL (agent.broks.beauty); a
// private-tier org's would point at TRMM_PRIVATE_API_BASE_URL
// (api.instaweb.top). In practice the private branch is defense-in-depth —
// POST /api/devices/deployments 403s for private orgs before any installer is
// built — but internal/admin tooling for the Task 62 PowerShell move flow
// still needs a way to resolve a private-domain install command.
//
// The type + normalizer live in ./agent-domain-tier (no server-only import)
// so client components can share the exact same rule — re-exported here so
// every existing server-side import of THIS file keeps working unchanged.
export type { AgentDomainTier } from "./agent-domain-tier";
export { normalizeAgentDomainTier, isPrivateTier } from "./agent-domain-tier";

/** Picks the tier's agent API base URL. Never reads the legacy single URL. */
export function resolveAgentApiBaseUrl(tier: unknown): string {
  return isPrivateTier(tier) ? env.trmmPrivateApiBaseUrl : env.trmmPublicApiBaseUrl;
}

// --- Task 82: per-org public agent-host ALLOWLIST + per-install selection ---
// Owner decision 2026-09-21 ("any user can get either or both from admin"):
// an org may hold MULTIPLE public hosts in Organization.agentApiHosts; the
// Add Device flow picks one at install time. Private orgs never select — they
// are hardwired to TRMM_PRIVATE_API_BASE_URL (Task 61 lockout unchanged).

export const DEFAULT_PUBLIC_AGENT_API_HOST = "agent.broks.beauty";
export const INSTAWEB_AGENT_API_HOST = "agent.instaweb.top";

/** The full known public host set — superset an admin allowlist may draw from. */
export const PUBLIC_AGENT_API_HOSTS: readonly string[] = [
  DEFAULT_PUBLIC_AGENT_API_HOST,
  INSTAWEB_AGENT_API_HOST,
];

function publicBaseUrlForHost(host: string): string {
  return host === INSTAWEB_AGENT_API_HOST
    ? env.trmmInstawebApiBaseUrl
    : env.trmmPublicApiBaseUrl;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Parses the org's stored allowlist (comma/space-separated hosts) into a
 * validated list. Public orgs: unknown/blank entries are dropped; an empty or
 * missing allowlist fails to the provisioning default ([broks]) so pre-Task-82
 * orgs behave byte-identically. Private orgs: ALWAYS the single private host —
 * the stored field is ignored (Task 61 restriction: private is not
 * self-service selectable).
 */
export function parseAgentApiHosts(raw: string | null | undefined, tier: unknown): string[] {
  if (isPrivateTier(tier)) return [hostnameOf(env.trmmPrivateApiBaseUrl)];
  const hosts = (raw ?? "")
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter((h) => PUBLIC_AGENT_API_HOSTS.includes(h));
  return hosts.length > 0 ? [...new Set(hosts)] : [DEFAULT_PUBLIC_AGENT_API_HOST];
}

/**
 * Resolves the agent API base URL for a CHOSEN host. Private tier ignores the
 * host entirely; a public host outside the known set fails closed to the
 * provisioning default (never throws — callers bake this into installers).
 */
export function resolveAgentApiBaseUrlForHost(tier: unknown, host: string | null | undefined): string {
  if (isPrivateTier(tier)) return env.trmmPrivateApiBaseUrl;
  const normalized = (host ?? "").trim().toLowerCase();
  return PUBLIC_AGENT_API_HOSTS.includes(normalized)
    ? publicBaseUrlForHost(normalized)
    : env.trmmPublicApiBaseUrl;
}
