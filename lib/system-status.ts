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
  generator: GeneratorStatus;
}

export interface GeneratorStatus {
  /** Web-app side: both MSI_GENERATOR_URL and MSI_GENERATOR_SECRET are set. */
  configured: boolean;
  url: string | null;
  /** Generator itself responded to GET /health. */
  reachable: boolean;
  payloadImported: boolean;
  payloadSha256: string | null;
  launcherMode: string | null;
  /** Machine-defined readiness flags mirrored from the generator /health body. */
  ready: boolean;
  launcherReady: boolean;
  msiReady: boolean;
  /** Human-readable requisites the generator considers missing. */
  missing: string[];
}

/** Ping TRMM + MeshCentral over HTTP and run a trivial Postgres query. */
export async function getSystemStatus(): Promise<SystemStatus> {
  const [trmm, mesh, database, generator] = await Promise.all([
    pingUrl(env.trmmApiBaseUrl),
    pingUrl(MESH_BASE_URL),
    pingDatabase(),
    getGeneratorStatus(),
  ]);
  return { trmm, mesh, database, generator };
}

/**
 * Fetch the generator's own /health (public, no secrets) and mirror its
 * requisites + payload status so the admin panel can surface "missing" items
 * instead of guessing. Non-fatal: if the generator is unreachable we report
 * that explicitly rather than crashing the status page.
 */
export async function getGeneratorStatus(): Promise<GeneratorStatus> {
  const url = env.msiGeneratorUrl;
  const configured = !!(url && env.msiGeneratorSecret);
  if (!url) {
    return emptyGenerator({ configured, url: null, reachable: false });
  }
  try {
    const res = await fetch(url.replace(/\/$/, "") + "/health", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return emptyGenerator({ configured, url, reachable: false });
    }
    const j = (await res.json().catch(() => null)) as Partial<GeneratorRecord> | null;
    if (!j) {
      return emptyGenerator({ configured, url, reachable: true });
    }
    return {
      configured,
      url,
      reachable: true,
      payloadImported: j.payload?.imported === true,
      payloadSha256: typeof j.payload?.sha256 === "string" ? j.payload.sha256 : null,
      launcherMode: typeof j.launcherMode === "string" ? j.launcherMode : null,
      ready: j.ready === true,
      launcherReady: j.launcherReady === true,
      msiReady: j.msiReady === true,
      missing: Array.isArray(j.missing) ? (j.missing as string[]) : [],
    };
  } catch {
    return emptyGenerator({ configured, url, reachable: false });
  }
}

interface GeneratorRecord {
  launcherMode?: string;
  payload?: { imported?: boolean; sha256?: string };
  ready?: boolean;
  launcherReady?: boolean;
  msiReady?: boolean;
  missing?: string[];
}

function emptyGenerator(
  base: Pick<GeneratorStatus, "configured" | "url" | "reachable">,
): GeneratorStatus {
  return {
    ...base,
    payloadImported: false,
    payloadSha256: null,
    launcherMode: null,
    ready: false,
    launcherReady: false,
    msiReady: false,
    missing: [],
  };
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