import "server-only";

import { env } from "./env";

export interface MsiResult {
  downloadUrl: string;
  vbsUrl: string;
  exeUrl?: string;
  expiresAt: string;
}

export interface CallMsiGeneratorOpts {
  clientId: number;
  siteId: number;
  agentType: string;
  authToken: string; // the TRMM Deployment uid
  apiUrl: string; // full base API URL with protocol — same as TRMM_API_BASE_URL
  manufacturer: string; // the customer's org name (user.orgName), per the generator's real contract
  pdf: File;
  ico?: File; // optional — triggers a branded EXE build on the generator side
  // Task 74: customer-facing download host for THIS build (e.g.
  // "https://dl.broks.beauty" for public-tier orgs; undefined = generator
  // default). Sent as a multipart field; older generators ignore it.
  downloadHost?: string;
}

/**
 * Calls the MSI generator service (cybersecurity engineer's external Fastify
 * service, built in parallel) to package a signed MSI that bakes in a
 * customer-uploaded PDF install guide.
 *
 * multipart/form-data POST to `${msiGeneratorUrl}/build`, bearer-token
 * authenticated, 60s timeout. Success returns `{ downloadUrl, vbsUrl, exeUrl?,
 * expiresAt }` — `exeUrl` is only present when an `ico` was uploaded. Any
 * failure throws (caller catches and returns a 502 — the underlying TRMM
 * Deployment/Site are NOT rolled back, matching the spec's guidance).
 *
 * Graceful-degradation contract: this is only invoked when both
 * `env.msiGeneratorUrl` and `env.msiGeneratorSecret` are non-null; the caller
 * checks that first and returns a friendly 503 otherwise.
 */
export async function callMsiGenerator(opts: CallMsiGeneratorOpts): Promise<MsiResult> {
  if (!env.msiGeneratorUrl || !env.msiGeneratorSecret) {
    throw new Error(
      "MSI generator is not configured (MSI_GENERATOR_URL / MSI_GENERATOR_SECRET not set).",
    );
  }

  const form = new FormData();
  form.append("clientId", String(opts.clientId));
  form.append("siteId", String(opts.siteId));
  form.append("agentType", opts.agentType);
  form.append("authToken", opts.authToken);
  form.append("apiUrl", opts.apiUrl);
  form.append("manufacturer", opts.manufacturer);
  form.append("pdf", opts.pdf);
  if (opts.ico) form.append("ico", opts.ico);
  // Task 74: tier-resolved download host (public-tier orgs only; allowlisted
  // generator-side, ignored by older generators).
  if (opts.downloadHost) form.append("downloadHost", opts.downloadHost);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${env.msiGeneratorUrl}/build`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.msiGeneratorSecret}` },
      body: form,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Partial<MsiResult> & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? `MSI generator ${res.status}`);
    }
    if (!data.downloadUrl || typeof data.downloadUrl !== "string") {
      throw new Error("MSI generator response missing downloadUrl");
    }
    if (!data.vbsUrl || typeof data.vbsUrl !== "string") {
      throw new Error("MSI generator response missing vbsUrl");
    }
    return {
      downloadUrl: data.downloadUrl,
      vbsUrl: data.vbsUrl,
      exeUrl: typeof data.exeUrl === "string" ? data.exeUrl : undefined,
      expiresAt:
        typeof data.expiresAt === "string" ? data.expiresAt : new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("MSI generator timed out after 60s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
