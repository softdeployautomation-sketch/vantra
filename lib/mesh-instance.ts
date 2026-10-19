// TASK_230 Section A.5 — instance-aware mesh host. The owner split MeshCentral
// into two fully independent instances (triage 2026-10-19):
//   - instance A "public"  → mesh.instaweb.top  (postgres store, existing devices)
//   - instance B "private" → mesh.broks.beauty  (flat-file store, Section B box)
// TRMM mints `/agents/<id>/meshcentral/` URLs against ONE site (its MESH_SITE
// still points at instance A), so a private-tier device's minted URLs carry the
// wrong host until TRMM itself is repointed (Section B.4 — owner). This module
// makes the RESOLUTION instance-aware on our side: whatever host TRMM returns,
// a `sw-<uid>-p` (private companion) org's URLs are rewritten to instance B and
// a public `sw-<uid>` org's to instance A.
//
// Deliberately PURE (no `server-only`, no env, no db) — same test posture as
// lib/sw-installer-names.ts, so node:test + tsx covers it directly.

/** MeshCentral instance A — the public host. */
export const MESH_PUBLIC_HOST = "mesh.instaweb.top";

/** MeshCentral instance B — the private host. */
export const MESH_PRIVATE_HOST = "mesh.broks.beauty";

/**
 * Both known mesh hosts. Only a field currently pointing at one of these is
 * rewritten — a value with any other host (or no host) is left byte-identical,
 * so we can never mangle an unrelated URL if TRMM's payload evolves.
 */
const KNOWN_MESH_HOSTS: ReadonlySet<string> = new Set([
  MESH_PUBLIC_HOST,
  MESH_PRIVATE_HOST,
]);

/**
 * Private-companion discriminator — mirrors `swPrivateOrgName()` in
 * lib/spaceworker-service.ts (`sw-<uid>-p`) and the `${swOrgName}-p` companion
 * lookup in the move route. Kept as an independent copy because this module is
 * pure/testable and lib/spaceworker-service.ts is `server-only` (imports db).
 * Non-`sw-` names are NOT private — they resolve to public, i.e. today's
 * single-instance behavior.
 */
export function isPrivateSwOrg(orgName: string): boolean {
  return orgName.startsWith("sw-") && orgName.endsWith("-p");
}

/** The mesh host a given org's devices talk to. */
export function meshHostForOrg(orgName: string): string {
  return isPrivateSwOrg(orgName) ? MESH_PRIVATE_HOST : MESH_PUBLIC_HOST;
}

/**
 * Rewrite the mesh host in ONE URL-ish string to `targetHost`. Preserves
 * scheme, port, path, query and fragment; only the hostname part changes, and
 * only when the current host is a known mesh host of the OTHER instance (a
 * same-host value round-trips unchanged; unknown hosts are never touched).
 * Returns the input unchanged when it isn't a parseable absolute URL.
 */
export function rewriteMeshUrlHost(value: string, targetHost: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (!KNOWN_MESH_HOSTS.has(parsed.hostname)) return value;
  if (parsed.hostname === targetHost) return value;
  // Validate with URL, but swap the hostname as a SUBSTRING of the original:
  // URL().toString() normalizes (e.g. appends "/" to a bare origin, turning
  // "wss://mesh.instaweb.top" into ".../"), and these payload values must
  // round-trip byte-identically apart from the host.
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return value;
  const authorityStart = schemeEnd + 3;
  let authorityEnd = value.length;
  for (const ch of ["/", "?", "#"]) {
    const idx = value.indexOf(ch, authorityStart);
    if (idx >= 0 && idx < authorityEnd) authorityEnd = idx;
  }
  const authority = value.slice(authorityStart, authorityEnd);
  if (authority === parsed.hostname) {
    // Hostname == full authority (no userinfo, no port) — simple swap.
    return value.slice(0, authorityStart) + targetHost + value.slice(authorityEnd);
  }
  // Port and/or userinfo present: replace only the hostname within authority.
  const hostEnd = authority.lastIndexOf(parsed.hostname);
  if (hostEnd < 0) return value;
  return (
    value.slice(0, authorityStart + hostEnd) +
    targetHost +
    value.slice(authorityStart + hostEnd + parsed.hostname.length)
  );
}

/** The MeshCentralUrls-shaped fields that embed the mesh host. */
const HOST_BEARING_FIELDS = [
  "control",
  "terminal",
  "file",
  "status",
  "client",
  "site",
] as const;

/**
 * Apply the org's instance host to a TRMM-minted MeshCentralUrls payload.
 *
 * `hostname` is deliberately excluded: confirmed live (view-only route) that
 * `urls.hostname` is the DEVICE's machine name — it feeds
 * findMeshNodeIdByHostname() for share-link node lookup, and rewriting it to
 * the mesh host would silently break view-only minting.
 */
export function applyMeshInstance<
  T extends Partial<Record<(typeof HOST_BEARING_FIELDS)[number], string>> & {
    hostname?: string;
  },
>(urls: T, orgName: string): T {
  const targetHost = meshHostForOrg(orgName);
  const out: T = { ...urls };
  for (const field of HOST_BEARING_FIELDS) {
    const value = out[field];
    if (typeof value === "string" && value) {
      out[field] = rewriteMeshUrlHost(value, targetHost) as T[typeof field];
    }
  }
  return out;
}
