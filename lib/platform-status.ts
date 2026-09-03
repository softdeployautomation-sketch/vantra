import "server-only";

import { pingUrl } from "./system-status";

// Product-level platform status for the admin dashboard. Distinct from
// lib/system-status.ts's infra reachability pings (TRMM/Mesh/DB): these are the
// two CUSTOMER-FACING products that share this box.
//
// - Vantra's liveness: the admin panel itself IS Vantra, so if this renders it's
//   up — but we surface a more meaningful signal via Postgres connectivity.
// - SpaceWorker: SpaceWorker is a separate Next.js app on its own systemd
//   service (spaceworker.service) listening on 127.0.0.1:3500. Reachability is a
//   plain HTTP ping to its localhost port — 200 means up (same pattern as
//   system-status's pingUrl for TRMM, which never returns before 200).

export const SPACEWORKER_BASE_URL = "http://127.0.0.1:3500/";

export interface PlatformStatus {
  vantra: boolean;
  spaceworker: boolean;
}

export async function getPlatformStatus(): Promise<PlatformStatus> {
  const [vantra, spaceworker] = await Promise.all([
    pingDatabase(),
    pingUrl(SPACEWORKER_BASE_URL),
  ]);
  return { vantra, spaceworker };
}

async function pingDatabase(): Promise<boolean> {
  try {
    // Lazy import so a platform-status check never pays the Prisma boot cost
    // unless a DB round-trip is actually requested.
    const { db } = await import("./db");
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}