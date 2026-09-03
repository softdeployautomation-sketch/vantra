import "server-only";

import { env } from "./env";

// Admin status page reachability pings — HTTP/DB only, no shell/systemctl access.
// Mesh has no existing static env var (its URLs are normally fetched per-agent),
// so it's a hardcoded reachability constant.

export const MESH_BASE_URL = "https://mesh.instaweb.top";

/**
 * HEAD-request reachability ping with a GET fallback for endpoints that respond
 * 405 to HEAD. Resolves false if the host is unreachable or the timeout hits.
 */
export async function pingUrl(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    // A 405 means the server is alive but doesn't allow HEAD — retry with GET.
    if (r.status === 405) {
      const g = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      return g.status < 500; // any 4xx/2xx means reachable
    }
    return r.status < 500;
  } catch {
    return false;
  }
}

export interface SystemStatus {
  trmm: boolean;
  mesh: boolean;
  database: boolean;
}

/** Ping TRMM + MeshCentral over HTTP and run a trivial Postgres query. */
export async function getSystemStatus(): Promise<SystemStatus> {
  const [trmm, mesh, database] = await Promise.all([
    pingUrl(env.trmmApiBaseUrl),
    pingUrl(MESH_BASE_URL),
    pingDatabase(),
  ]);
  return { trmm, mesh, database };
}

async function pingDatabase(): Promise<boolean> {
  try {
    // Lazy import so this stays out of the hot page path until a status check.
    const { db } = await import("./db");
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}