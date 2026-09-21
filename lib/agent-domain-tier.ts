// Task 61/65: the pure tier type + normalizer, split out of lib/agent-domains.ts
// so client components (e.g. components/tier-badge.tsx) can share the exact
// same "unknown/missing -> public" rule without importing that file's
// "server-only" (it also pulls in lib/env.ts for the API base URL lookup).
// Keep this file free of server-only imports.

export type AgentDomainTier = "public" | "private";

/** Unknown/missing values fail safe to "public" (the provisioning default). */
export function normalizeAgentDomainTier(value: unknown): AgentDomainTier {
  return value === "private" ? "private" : "public";
}

export function isPrivateTier(value: unknown): boolean {
  return normalizeAgentDomainTier(value) === "private";
}
