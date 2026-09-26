// TASK_121 §4/§8 — the optional `installer` block on
// POST /api/internal/sw/orgs/[orgId]/install-link (the frozen contract).
//
// Deliberately NOT `server-only`: every export here is a pure function (no
// env, no db, no secret) so it can be unit-tested directly with a plain
// node/tsx script — see tests/install-link-zip.test.ts — without any of the
// "stub server-only" tricks HOW_WE_MOVE_FAST.md documents for code that
// genuinely needs them. Keep it that way; if a future change needs env or db
// access, move that call site into the route, not into this file.
//
// The sanitizer below is a DELIBERATE separate copy of
// lib/zip-generator.ts's private `safeArtifactName` (lines 51-57 there), not
// an import of it — that module is `server-only` and constructs its request
// body assuming every name has already been through type-checking (it calls
// `.trim()` on `value ?? ""`, which throws for a non-string like a JSON
// number). This file is the FIRST gate: it accepts `unknown` straight from a
// parsed request body and only ever returns a string or `undefined`, so an
// invalid or wrongly-typed value can never reach callZipGenerator, let alone
// the generator itself. Same rule, same result, checked at the door instead
// of two layers in — if the rule ever changes, change both copies together.

const INVALID_ARTIFACT_NAME = /[/\\"\x00-\x1f]/;

/**
 * Sanitizes one optional artifact name (zipName / updateLinkName /
 * innerFolder). Anything not a non-empty, ≤64-char bare string with no
 * `/ \ "`, control character, or `..` resolves to `undefined` — never a
 * thrown error, never a 400. The caller omits the field entirely when this
 * returns `undefined`, which is what lets an invalid name fall back to the
 * generator's own default instead of blocking the whole install (TASK_121
 * §4, §6 item 3).
 */
export function safeArtifactName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (INVALID_ARTIFACT_NAME.test(s)) return undefined;
  if (s.includes("..")) return undefined;
  if (s.length > 64) return undefined;
  return s;
}

// ---------------------------------------------------------------------------
// Task 125 — the optional guide PDF (Vantra's Task 77/78 "FIX 5"), now
// reachable from the sw- path.
//
// The PDF rules below are a DELIBERATE mirror of the reference implementation
// that already gates Vantra's own dashboard uploads —
// app/api/devices/deployments/route.ts::validateZipPdfFields (magic `%PDF`,
// ≤20 MB, bare `*.pdf` name) and lib/zip-generator.ts::safePdfName — checked
// at the door instead of two layers in, exactly like safeArtifactName above.
// If the rule ever changes, change all of them together.
//
// Unlike the three names, an unusable PDF here is DROPPED rather than loud:
// this module's contract is "pure, total, never throws" (it is also the
// fallback for a caller older than this task). SpaceWorker's own route is the
// LOUD gate — it answers 400/413 before the body ever leaves their server — so
// a silent drop can only happen for a hand-crafted request, which is precisely
// the case where "still get an installer" beats "500".
// ---------------------------------------------------------------------------

/** 20 MB of DECODED bytes — the reference route's and generator's ceiling. */
export const MAX_INSTALLER_PDF_BYTES = 20 * 1024 * 1024;

/** Bare `*.pdf` entry-name rule — note `:` too, for the Windows drive trap. */
const INVALID_PDF_NAME = /[/\\:"\x00-\x1f]/;

/** Base64 alphabet (with optional `=` padding) — validates without decoding. */
const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/;

/** A bare `*.pdf` entry name, or undefined. Mirrors the generator's rule. */
export function safePdfName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (!/\.pdf$/i.test(s)) return undefined;
  if (INVALID_PDF_NAME.test(s)) return undefined;
  if (s.includes("..")) return undefined;
  if (s.length > 64) return undefined;
  return s;
}

/**
 * A whole 0–120 second open delay, or undefined (generator default 0 = now).
 *
 * A numeric string is accepted (the body is JSON and the reference route's zod
 * coerces); everything that is NOT a genuine number — `null`, `undefined`,
 * `""`, `true`, an object — is ABSENT, never 0. The explicit guards are
 * load-bearing: `Number(null)` is 0, so a bare coercion would silently turn
 * `pdfDelaySec: null` into "open the guide immediately" instead of "nothing
 * specified".
 */
export function safePdfDelay(value: unknown): number | undefined {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "") n = Number(value);
  else return undefined;
  if (!Number.isFinite(n) || n < 0 || n > 120) return undefined;
  return Math.floor(n);
}

function decodeHead(bytes: string): string {
  return Buffer.from(bytes, "base64").toString("latin1");
}

/**
 * Is `value` a base64 payload (a `data:application/pdf;base64,…` URL or raw
 * base64) that plausibly IS a PDF? Returns the payload to forward (exactly
 * what arrived, so the generator sees the shape the reference route sends), or
 * undefined.
 *
 * Cheap ON PURPOSE: the `%PDF` magic comes from the first 8 base64 characters
 * (→ 6 bytes) and the decoded size is derived by length arithmetic, so a 27 MB
 * string is never decoded here. The generator — the only thing that actually
 * unpacks the zip — stays the final authority on the real bytes.
 */
export function safePdfBase64(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const b64 = (raw.startsWith("data:") ? raw.replace(/^data:[^;]+;base64,/, "") : raw)
    .replace(/\s+/g, "");
  if (b64.length < 8 || !BASE64_ONLY.test(b64)) return undefined;
  // 4 base64 chars ⇒ 3 bytes; round UP so the ceiling can never be slipped.
  if (Math.ceil((b64.length * 3) / 4) > MAX_INSTALLER_PDF_BYTES) return undefined;
  const head = decodeHead(b64.slice(0, 8));
  if (head.length < 4 || head.slice(0, 4) !== "%PDF") return undefined;
  return raw;
}

export type InstallerKind = "zip" | "exe";

export interface ParsedInstaller {
  kind: InstallerKind;
  /** Present only when kind === "zip" and the name sanitized cleanly. */
  zipName?: string;
  updateLinkName?: string;
  innerFolder?: string;
  /** Task 125 — the optional guide PDF to forward, verbatim. Only ever set
   *  together with `pdfName`; absent for every pre-Task-125 request. */
  pdf?: string;
  pdfName?: string;
  pdfDelaySec?: number;
}

/**
 * Parses the OPTIONAL `installer` block out of the request body already
 * JSON-parsed by the route. Every one of these resolves to `{ kind: "exe" }`
 * — today's behavior, byte-identical (TASK_121 §4's backward-compatibility
 * guarantee, §6 item 1):
 *   - `body` is `undefined`/`null`/not an object (absent or unparseable body)
 *   - `body.installer` is absent, `null`, or not an object
 *   - `body.installer.kind` is anything other than the literal string "zip"
 *     (including absent, `undefined`, or an unrecognized value — §4: "An
 *     unknown `kind` ⇒ treat as absent")
 *
 * Only a genuine `kind: "zip"` reaches the name-sanitizing branch, and each
 * name is independently sanitized — one invalid name never affects the
 * others, and never turns the whole request into a 400.
 *
 * Task 125 adds the optional guide PDF, parsed on the SAME independent-field
 * principle one level further: the PDF and the three names never affect each
 * other, and `pdfName`/`pdfDelaySec` are only ever emitted alongside a valid
 * `pdf` (a name with nothing to name is not forwarded — the generator would
 * reject that combination anyway; see validateZipPdfFields, which 400s it).
 * A record without any `pdf` key returns exactly the pre-Task-125 object.
 */
export function parseInstaller(body: unknown): ParsedInstaller {
  if (!body || typeof body !== "object") return { kind: "exe" };
  const installer = (body as Record<string, unknown>).installer;
  if (!installer || typeof installer !== "object") return { kind: "exe" };
  const rec = installer as Record<string, unknown>;
  if (rec.kind !== "zip") return { kind: "exe" };
  const parsed: ParsedInstaller = {
    kind: "zip",
    zipName: safeArtifactName(rec.zipName),
    updateLinkName: safeArtifactName(rec.updateLinkName),
    innerFolder: safeArtifactName(rec.innerFolder),
  };
  const pdf = safePdfBase64(rec.pdf);
  if (pdf) {
    parsed.pdf = pdf;
    const pdfName = safePdfName(rec.pdfName);
    if (pdfName) parsed.pdfName = pdfName;
    const pdfDelaySec = safePdfDelay(rec.pdfDelaySec);
    if (pdfDelaySec !== undefined) parsed.pdfDelaySec = pdfDelaySec;
  }
  return parsed;
}
