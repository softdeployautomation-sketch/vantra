import "server-only";

import { env } from "./env";

// Task 93 — shared fail-closed gate for the SpaceWorker plugin routes under
// /api/internal/sw/*. The token is the SAME secret SpaceWorker stores as its
// VANTRA_INTERNAL_TOKEN env (added on the VPS by hand — never rsynced).
// Mirrors verifyInternalSecret's posture: unset token or wrong/missing header
// always 401 (never "open").
export function verifySwSecret(request: Request): boolean {
  const expected = env.swInternalToken;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length).trim();
  return supplied.length > 0 && supplied === expected;
}