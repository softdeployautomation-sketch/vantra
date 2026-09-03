import "server-only";

import { env } from "./env";

// Minimal shared gate for the internal cron callbacks (/api/internal/*). Uses a
// plain `Authorization: Bearer <INTERNAL_CRON_SECRET>` header compare — the same
// posture as the MSI generator's own bearer-token auth. FAILS CLOSED: unset
// secret or a wrong/missing header always returns 401 (never "open").
export function verifyInternalSecret(request: Request): boolean {
  const expected = env.internalCronSecret;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length).trim();
  return supplied.length > 0 && supplied === expected;
}