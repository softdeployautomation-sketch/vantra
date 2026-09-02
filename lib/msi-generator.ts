import "server-only";

import { env } from "./env";

export interface MsiResult {
  downloadUrl: string;
  expiresAt: string;
}

export interface CallMsiGeneratorOpts {
  clientId: number;
  siteId: number;
  agentType: string;
  authToken: string; // the TRMM Deployment uid
  apiUrl: string; // full base API URL with protocol — same as TRMM_API_BASE_URL
  pdf: File;
}

/**
 * Calls the MSI generator service (cybersecurity engineer's external service,
 * built in parallel) to package a signed MSI that bakes in a customer-uploaded
 * PDF install guide.
 *
 * multipart/form-data POST to `${msiGeneratorUrl}/build`, 60s timeout. Success
 * returns `{ downloadUrl, expiresAt }`; any failure throws (caller catches and
 * returns a 502 — the underlying TRMM Deployment/Site are NOT rolled back,
 * matching the spec's guidance).
 *
 * Graceful-degradation contract: this is only invoked when `env.msiGeneratorUrl`
 * is non-null; the caller checks that first and returns a friendly 503 otherwise.
 */
export async function callMsiGenerator(opts: CallMsiGeneratorOpts): Promise<MsiResult> {
  if (!env.msiGeneratorUrl) {
    throw new Error("MSI generator is not configured (MSI_GENERATOR_URL not set).");
  }

  const form = new FormData();
  form.append("clientId", String(opts.clientId));
  form.append("siteId", String(opts.siteId));
  form.append("agentType", opts.agentType);
  form.append("authToken", opts.authToken);
  form.append("apiUrl", opts.apiUrl);
  form.append("manufacturer", "VANTRA");
  form.append("pdf", opts.pdf);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${env.msiGeneratorUrl}/build`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `MSI generator ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as Partial<MsiResult>;
    if (!data.downloadUrl || typeof data.downloadUrl !== "string") {
      throw new Error("MSI generator response missing downloadUrl");
    }
    return {
      downloadUrl: data.downloadUrl,
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
