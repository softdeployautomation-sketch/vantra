import "server-only";

// Task 26 — resolve the device-credential callback URL, HTTPS-only, fail-closed.
//
// The on-device prompt POSTs the PIN to this URL, so it MUST be a public HTTPS
// origin. A localhost / bare-http / missing value is either unreachable (the
// observed "Unable to submit. Please try again." bug — the prompt was posting to
// the target machine's OWN http://localhost:3300) or would leak the PIN over
// plaintext HTTP. Both are unacceptable, so this throws CallbackUrlError BEFORE
// any prompt is launched rather than ever handing the agent a callback URL that
// cannot be reached or is not encrypted.

export class CallbackUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallbackUrlError";
  }
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/**
 * Normalize a configured APP_BASE_URL into the absolute HTTPS URL the on-device
 * prompt should POST the credential to (`<origin>/api/device-callback/credential`).
 *
 * Rules (all fail-closed by throwing CallbackUrlError):
 *  - missing / blank / unparseable value            → throw
 *  - non-http(s) scheme                              → throw
 *  - bare `http://` (no usable host)                 → throw
 *  - loopback host (localhost / 127.0.0.1 / ::1)     → throw (a device can't
 *    reach its own loopback, and it would be plaintext anyway)
 *  - leading `http://` on a real public host         → upgraded to `https://`
 *  - trailing slash / any path / query / hash        → normalized away; the
 *    callback always lives at the origin root
 */
export function resolveDeviceCallbackUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new CallbackUrlError(
      "APP_BASE_URL is not set — cannot build a device-unlock callback URL.",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CallbackUrlError("APP_BASE_URL is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CallbackUrlError(
      "APP_BASE_URL must be http(s) — refusing to send a device PIN over a non-HTTP scheme.",
    );
  }

  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || host.startsWith("127.")) {
    throw new CallbackUrlError(
      "APP_BASE_URL resolves to a loopback address — a device cannot submit a credential to its own localhost.",
    );
  }

  if (!host) {
    throw new CallbackUrlError(
      "APP_BASE_URL has no host — refusing a bare http:// callback URL.",
    );
  }

  // Force HTTPS: upgrade a plain http:// origin (never send a PIN over HTTP).
  url.protocol = "https:";
  url.pathname = "";
  url.search = "";
  url.hash = "";

  const origin = url.toString().replace(/\/+$/, "");
  return `${origin}/api/device-callback/credential`;
}