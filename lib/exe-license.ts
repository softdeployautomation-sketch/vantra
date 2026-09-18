import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

// Task 44.2 — Vantra EXE license scheme. A faithful port of SpaceWorker's
// `lib/exe-license.ts` (the proven EXE-licensing pattern), but with Vantra's
// OWN signing secret and its OWN product identity — never shared with
// SpaceWorker's key-signing secret (that security-boundary decision is
// confirmed in TASK_44_VANTRA_DESKTOP_EXE.md: a leaked secret in one app can
// never forge licenses for the other).
//
//   payload   = { licensee, plan, product, issued_at, expires_at }  (`product` is
//               the Vantra EXE product id — "vantra_exe" — signed into the key so
//               a key minted for one product can never activate in another. No
//               machine binding server-side at issuance; that happens client-side
//               inside the EXE at first activation.)
//   payload_json = JSON.stringify(payload) with keys sorted ALPHABETICALLY.
//                  Python's json.dumps(sort_keys=True) emits a space after the
//                  colon and after each comma; Node's JSON.stringify does not,
//                  so we hand-roll an exact-match serializer below.
//   payload_b64  = base64url(payload_json)
//   signature    = hex( HMAC-SHA256(secret, payload_b64) )
//   license_key  = `${payload_b64}.${signature}`

// The duration of every Vantra EXE license. Same real 6-month term SpaceWorker
// uses; adjustable per product/plan later if billing wants tiers.
export const EXE_LICENSE_DAYS = 180;

/** The running build's product identity (single Vantra EXE today). */
export const EXE_PRODUCT = "vantra_exe";

// The stable, branded URL customers use to download the Vantra EXE installer
// (self-service flow, Settings → License). Reuses the SAME masked-download
// host as SpaceWorker (dl.instaweb.top's existing `location /spaceworker/`
// pattern, mirrored here as `/vantra/`) rather than a second, inconsistent
// convention on vantra.instaweb.top directly — one shared download host for
// every desktop build. Serves from `/opt/vantra/downloads/` on the VPS, a
// static nginx block (dl.instaweb.top.conf), verified reachable 2026-09-18 —
// NOT a raw github.com artifact link (those change per build and are
// auto-deleted). The artifact there is uploaded manually after independent
// verification, never built directly on the download host.
export const EXE_DOWNLOAD_URL =
  process.env.VANTRA_EXE_DOWNLOAD_URL ??
  "https://dl.instaweb.top/vantra/vantra-desktop-setup.exe";

const BASE64URL_RE = /^[A-Za-z0-9_-]+=*$/;

/**
 * Reads the Vantra EXE-license signing secret. Its own env var
 * (EXE_LICENSE_SECRET) — never reuse SESSION_SECRET or any other existing
 * secret, because a leaked key-signing secret can forge unlimited licenses.
 *
 * Fail-CLOSED rather than required(): the app still builds and boots for a
 * local build without it (mirroring ADMIN_TOKEN's discipline), but validating /
 * issuing a license throws at runtime until it's set, so a production deploy
 * can't silently mint unverifiable keys.
 */
export function exeLicenseSecret(): string {
  const secret = process.env.EXE_LICENSE_SECRET ?? "";
  if (secret.trim().length === 0) {
    throw new Error(
      "EXE_LICENSE_SECRET is not configured — cannot sign/validate Vantra EXE licenses. Set it in the environment before approving any EXE payment or activating a key.",
    );
  }
  return secret;
}

// Python's json.dumps(sort_keys=True) with default separators (", ", ": "), for
// the flat string-valued payloads this scheme produces. Produces:
//   {"expires_at": "...", "issued_at": "...", "licensee": "x", "plan": "pro", "product": "vantra_exe"}
// byte-identical to what generator.py base64-encodes.
function pyJsonDumpsSorted(obj: LicensePayload): string {
  const rec = obj as unknown as Record<string, string>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(rec[k])}`);
  return `{${parts.join(", ")}}`;
}

// Matches Python's `datetime.utcnow().isoformat()` EXACTLY — no 'Z' suffix, no
// timezone offset, 6-digit microsecond fraction (the form the validator port,
// lib/exe-license-validator.ts, parses with an appended 'Z').
function toPythonIsoformat(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  const micro = pad(d.getUTCMilliseconds() * 1000, 6);
  return `${y}-${mo}-${day}T${h}:${mi}:${s}.${micro}`;
}

function sign(payloadB64: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payloadB64, "utf8");
  return Buffer.from(hmac.digest()).toString("hex");
}

export interface GenerateLicenseKeyInput {
  /** The buyer's email — embedded as `licensee`. */
  licensee: string;
  /** The purchased plan slug. */
  plan: string;
  /** The product this key is FOR — "vantra_exe". Enforced at activation. */
  product: string;
  daysValid?: number; // defaults to EXE_LICENSE_DAYS (180)
  // Task 44.2b — a claim re-signs the key with the buyer's device machine_id,
  // appearing in the payload as `machine_id`. ABSENT for the instant unbound key
  // (which the activation route now rejects). The offline validator honours
  // `machine_id` when present, so the bound key is enforced offline.
  machineId?: string;
  // Task 44.2b — an explicit expiry (from a claim preserving an original key's
  // exact remaining validity) wins over the `now + daysValid` default, so
  // binding a machine never resets or extends the term.
  expiresAt?: Date;
  at?: Date; // test seam: override "now" for deterministic keys
}

export interface IssuedLicense {
  licenseKey: string;
  payload: LicensePayload;
  issuedAt: Date;
  expiresAt: Date;
}

export interface LicensePayload {
  licensee: string;
  plan: string;
  /** The product this key is FOR — the Vantra EXE product id ("vantra_exe"). */
  product: string;
  issued_at: string;
  expires_at: string;
  // Optional machine binding — READ/validated by lib/exe-license-validator.ts.
  // For the INSTANT-PURCHASE unbound key (a purchase reference, which the
  // activation route now rejects) this is absent; a claim re-signs the same
  // payload with `machine_id` set (Task 44.2b). `machine_ids` honored for
  // compatibility with the older standalone generator's multi-machine keys.
  machine_id?: string;
  machine_ids?: string[];
}

/**
 * Generates a signed license key in the Vantra EXE format. Returns the full key
 * plus the decoded payload / dates so callers can surface the real expiry
 * without decoding it back.
 */
export function generateLicenseKey(input: GenerateLicenseKeyInput): IssuedLicense {
  const secret = exeLicenseSecret();
  const daysValid = input.daysValid ?? EXE_LICENSE_DAYS;
  const now = input.at ?? new Date();

  const issuedAt = now;
  // Task 44.2b: an explicit `expiresAt` (used by the claim step to preserve an
  // original key's exact remaining validity) wins over `now + daysValid`, so
  // binding a machine never resets or extends the term.
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000);

  const payload: LicensePayload = {
    licensee: String(input.licensee),
    plan: String(input.plan),
    product: String(input.product),
    issued_at: toPythonIsoformat(issuedAt),
    expires_at: toPythonIsoformat(expiresAt),
  };
  // Task 44.2b — a claim re-signs the key with the buyer's device; the field is
  // ABSENT for the instant unbound purchase-reference key (which the EXE
  // activation route now rejects). The offline validator honours `machine_id`
  // when present.
  if (input.machineId) {
    payload.machine_id = String(input.machineId);
  }

  const payloadJson = pyJsonDumpsSorted(payload);
  const payloadB64 = b64urlEncode(payloadJson);
  const signature = sign(payloadB64, secret);

  return {
    licenseKey: `${payloadB64}.${signature}`,
    payload,
    issuedAt,
    expiresAt,
  };
}

/** Decodes the base64url payload of a key WITHOUT verifying its signature. */
export function decodeLicenseKey(licenseKey: string): LicensePayload | null {
  const parts = licenseKey.trim().split(".");
  if (parts.length !== 2 || !BASE64URL_RE.test(parts[0])) return null;
  try {
    return JSON.parse(b64urlDecode(parts[0]));
  } catch {
    return null;
  }
}

/**
 * Re-derives the HMAC over the key's payload and constant-time-compares it to
 * the key's own signature. Returns true only for a genuinely valid key under the
 * configured secret.
 */
export function verifyLicenseKey(licenseKey: string): boolean {
  const parts = licenseKey.trim().split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  if (!BASE64URL_RE.test(payloadB64) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  try {
    const expected = sign(payloadB64, exeLicenseSecret());
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function b64urlEncode(text: string): string {
  // Python's base64.urlsafe_b64encode always includes '=' padding; Node's
  // Buffer#toString('base64url') strips it. The signature covers the exact
  // stored base64url string, so we must match Python's padded form byte-for-byte.
  let encoded = Buffer.from(text, "utf8").toString("base64url");
  const remainder = encoded.length % 4;
  if (remainder !== 0) encoded += "=".repeat(4 - remainder);
  return encoded;
}

function b64urlDecode(text: string): string {
  return Buffer.from(text, "base64url").toString("utf8");
}