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
