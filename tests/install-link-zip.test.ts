// TASK_121 §5 PATH A / §6 acceptance items 1 and 3.
//
// Tests lib/sw-installer-names.ts directly — the module is deliberately NOT
// `server-only` (no env, no db, no secret) so it needs none of the
// stub-and-import() tricks HOW_WE_MOVE_FAST.md documents for code that
// genuinely requires the Next.js server context. This repo has no test
// framework configured (no vitest/jest in package.json); Node's own built-in
// test runner (`node:test` + `node:assert/strict`) needs neither, and `tsx`
// is already a devDependency.
//
// Run: npx tsx --test tests/install-link-zip.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseInstaller, safeArtifactName, safePdfName, safePdfDelay, safePdfBase64 } from "../lib/sw-installer-names";

// --- §6 item 1: backward compatibility — every one of these must resolve to
// exactly { kind: "exe" }, today's behavior, byte-identical. ---------------

test("parseInstaller: undefined body -> exe (absent body)", () => {
  assert.deepEqual(parseInstaller(undefined), { kind: "exe" });
});

test("parseInstaller: null body -> exe", () => {
  assert.deepEqual(parseInstaller(null), { kind: "exe" });
});

test("parseInstaller: {} -> exe (installer absent)", () => {
  assert.deepEqual(parseInstaller({}), { kind: "exe" });
});

test("parseInstaller: installer: null -> exe", () => {
  assert.deepEqual(parseInstaller({ installer: null }), { kind: "exe" });
});

test("parseInstaller: installer not an object -> exe", () => {
  assert.deepEqual(parseInstaller({ installer: "zip" }), { kind: "exe" });
});

test("parseInstaller: installer: {} (no kind) -> exe", () => {
  assert.deepEqual(parseInstaller({ installer: {} }), { kind: "exe" });
});

test("parseInstaller: unrecognized kind -> exe (§4: 'an unknown kind treated as absent')", () => {
  assert.deepEqual(parseInstaller({ installer: { kind: "msi" } }), { kind: "exe" });
  assert.deepEqual(parseInstaller({ installer: { kind: "" } }), { kind: "exe" });
  assert.deepEqual(parseInstaller({ installer: { kind: 1 } }), { kind: "exe" });
});

test("parseInstaller: a non-object top-level body -> exe (never throws)", () => {
  assert.deepEqual(parseInstaller("not json"), { kind: "exe" });
  assert.deepEqual(parseInstaller(42), { kind: "exe" });
  assert.deepEqual(parseInstaller([]), { kind: "exe" });
});

// --- kind: "zip" with clean names — every field present, sanitized as-is. -

test("parseInstaller: kind zip with all three valid names", () => {
  const result = parseInstaller({
    installer: { kind: "zip", zipName: "TaxReturn.zip", updateLinkName: "TaxReturn", innerFolder: "setup" },
  });
  assert.deepEqual(result, {
    kind: "zip",
    zipName: "TaxReturn.zip",
    updateLinkName: "TaxReturn",
    innerFolder: "setup",
  });
});

test("parseInstaller: kind zip with no names -> all three omitted (undefined), not blank strings", () => {
  const result = parseInstaller({ installer: { kind: "zip" } });
  assert.equal(result.kind, "zip");
  assert.equal(result.zipName, undefined);
  assert.equal(result.updateLinkName, undefined);
  assert.equal(result.innerFolder, undefined);
});

// --- §6 item 3: invalid input is refused per-field, never fatal to the mint.

test("safeArtifactName: rejects path traversal ('../evil')", () => {
  assert.equal(safeArtifactName("../evil"), undefined);
});

test("safeArtifactName: rejects an embedded forward slash ('a/b')", () => {
  assert.equal(safeArtifactName("a/b"), undefined);
});

test("safeArtifactName: rejects an embedded backslash ('a\\\\b')", () => {
  assert.equal(safeArtifactName("a\\b"), undefined);
});

test("safeArtifactName: rejects an embedded double-quote ('a\"b')", () => {
  assert.equal(safeArtifactName('a"b'), undefined);
});

test("safeArtifactName: rejects 65+ characters", () => {
  assert.equal(safeArtifactName("a".repeat(65)), undefined);
  assert.equal(safeArtifactName("a".repeat(64)), "a".repeat(64)); // boundary: 64 is fine
});

test("safeArtifactName: rejects control characters", () => {
  assert.equal(safeArtifactName("a\u0000b"), undefined);
  assert.equal(safeArtifactName("a\nb"), undefined);
  assert.equal(safeArtifactName("a\tb"), undefined);
});

test("safeArtifactName: rejects blank / whitespace-only", () => {
  assert.equal(safeArtifactName(""), undefined);
  assert.equal(safeArtifactName("   "), undefined);
});

test("safeArtifactName: rejects non-string values without throwing (a malformed JSON body)", () => {
  assert.equal(safeArtifactName(123), undefined);
  assert.equal(safeArtifactName(true), undefined);
  assert.equal(safeArtifactName(null), undefined);
  assert.equal(safeArtifactName(undefined), undefined);
  assert.equal(safeArtifactName({}), undefined);
  assert.equal(safeArtifactName(["a"]), undefined);
});

test("safeArtifactName: trims surrounding whitespace on an otherwise-valid name", () => {
  assert.equal(safeArtifactName("  TaxReturn  "), "TaxReturn");
});

test("safeArtifactName: accepts a normal bare name unchanged", () => {
  assert.equal(safeArtifactName("Update"), "Update");
  assert.equal(safeArtifactName("Agent.zip"), "Agent.zip");
});

// One invalid name must not affect the other two fields in the same request —
// §6 item 3: "that field is omitted (default used), the mint still succeeds".
test("parseInstaller: one invalid name is omitted while the other two survive", () => {
  const result = parseInstaller({
    installer: {
      kind: "zip",
      zipName: "../evil.zip",
      updateLinkName: "TaxReturn",
      innerFolder: "setup",
    },
  });
  assert.deepEqual(result, {
    kind: "zip",
    zipName: undefined,
    updateLinkName: "TaxReturn",
    innerFolder: "setup",
  });
});

test("parseInstaller: all three names invalid -> kind zip still returned, all three omitted", () => {
  const result = parseInstaller({
    installer: { kind: "zip", zipName: "a/b", updateLinkName: "a\"b", innerFolder: "x".repeat(65) },
  });
  assert.equal(result.kind, "zip");
  assert.equal(result.zipName, undefined);
  assert.equal(result.updateLinkName, undefined);
  assert.equal(result.innerFolder, undefined);
});

// Note on §4's ".lnk auto-append" (D6): deliberately NOT tested here.
// callZipGenerator (lib/zip-generator.ts, untouched by this task) already
// owns that behavior for every caller, including this route — re-testing it
// here would duplicate coverage of a module this task was explicitly told
// not to touch, not add new coverage.

// ---------------------------------------------------------------------------
// TASK_125 — the optional guide PDF on the sw- path (Task 77/78 "FIX 5").
//
// Same principle as the names: independent per field, never fatal, and absent
// entirely for a request that carries none — which is what keeps every
// pre-Task-125 request byte-identical.
// ---------------------------------------------------------------------------

// A magic-correct PDF payload, base64: `%PDF-1.4…` base64-encoded.
const PDF_B64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "latin1").toString("base64");
const PDF_DATA_URL = `data:application/pdf;base64,${PDF_B64}`;

test("safePdfName: accepts a bare *.pdf name and trims it", () => {
  assert.equal(safePdfName("guide.pdf"), "guide.pdf");
  assert.equal(safePdfName("  Install Guide.PDF  "), "Install Guide.PDF");
  assert.equal(safePdfName("a".repeat(60) + ".pdf"), "a".repeat(60) + ".pdf");
});

test("safePdfName: rejects anything that is not a bare *.pdf name", () => {
  for (const value of [
    "guide.txt", // not a PDF
    "guide", // no extension
    "../evil.pdf", // traversal
    "a/b.pdf", // separator
    "a\\b.pdf", // Windows separator
    'a"b.pdf', // quote
    "C:guide.pdf", // drive/colon
    "nul\u0000.pdf", // control
    "a".repeat(61) + ".pdf", // 65 chars — one past the boundary
    "", // blank
    "   ",
    undefined,
    null,
    42,
    {},
    ["guide.pdf"],
  ]) {
    assert.equal(
      safePdfName(value),
      undefined,
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});

test("safePdfDelay: accepts 0–120 whole seconds, rejects everything else", () => {
  assert.equal(safePdfDelay(0), 0); // 0 is VALID — the generator default
  assert.equal(safePdfDelay(120), 120);
  assert.equal(safePdfDelay(12.9), 12); // floored, like the generator
  assert.equal(safePdfDelay(121), undefined);
  assert.equal(safePdfDelay(-1), undefined);
  assert.equal(safePdfDelay("soon"), undefined);
  assert.equal(safePdfDelay(undefined), undefined);
  assert.equal(safePdfDelay(null), undefined);
});

test("safePdfBase64: accepts a data URL and raw base64, returning the payload trimmed", () => {
  assert.equal(safePdfBase64(PDF_DATA_URL), PDF_DATA_URL);
  assert.equal(safePdfBase64(PDF_B64), PDF_B64);
  // Whitespace/newlines in the base64 (a MIME-wrapped body) are tolerated and
  // trimmed away — the generator gets the clean payload it expects.
  assert.equal(
    safePdfBase64(`  data:application/pdf;base64,${PDF_B64}\n`),
    PDF_DATA_URL,
  );
});

test("safePdfBase64: rejects a payload that is not a PDF, is oversized, or is not base64", () => {
  const notPdf = Buffer.from("this is not a pdf at all", "latin1").toString("base64");
  assert.equal(safePdfBase64(notPdf), undefined, "no %PDF magic");
  assert.equal(safePdfBase64("%PDF-1.4"), undefined, "not base64 at all");
  assert.equal(safePdfBase64("abc"), undefined, "too short to carry a magic");
  assert.equal(
    safePdfBase64("A".repeat(Math.ceil((20 * 1024 * 1024 * 4) / 3) + 8)),
    undefined,
    "over the 20 MB decoded ceiling",
  );
  assert.equal(safePdfBase64(undefined), undefined);
  assert.equal(safePdfBase64(null), undefined);
  assert.equal(safePdfBase64({}), undefined);
});

test("parseInstaller: a valid PDF with a name and delay is forwarded on the zip block", () => {
  const result = parseInstaller({
    installer: {
      kind: "zip",
      zipName: "TaxReturn.zip",
      pdf: PDF_DATA_URL,
      pdfName: "guide.pdf",
      pdfDelaySec: 5,
    },
  });
  assert.equal(result.kind, "zip");
  assert.equal(result.zipName, "TaxReturn.zip");
  assert.equal(result.pdf, PDF_DATA_URL, "forwarded verbatim — the generator expects the data URL");
  assert.equal(result.pdfName, "guide.pdf");
  assert.equal(result.pdfDelaySec, 5);
});

test("parseInstaller: a PDF with no names still yields the zip block (generator defaults)", () => {
  const result = parseInstaller({ installer: { kind: "zip", pdf: PDF_DATA_URL } });
  assert.equal(result.kind, "zip");
  assert.equal(result.pdf, PDF_DATA_URL);
  assert.equal(result.zipName, undefined);
  assert.equal(result.pdfName, undefined, "no name given ⇒ omitted, generator falls back to guide.pdf");
  assert.equal(result.pdfDelaySec, undefined);
});

test("parseInstaller: a bad PDF is DROPPED and the names survive untouched", () => {
  const result = parseInstaller({
    installer: {
      kind: "zip",
      zipName: "TaxReturn.zip",
      innerFolder: "setup",
      pdf: "bm90IGEgcGRm", // "not a pdf" — valid base64, no %PDF magic
      pdfName: "guide.pdf",
    },
  });
  assert.equal(result.kind, "zip");
  assert.equal(result.zipName, "TaxReturn.zip");
  assert.equal(result.innerFolder, "setup");
  assert.equal(result.pdf, undefined, "a payload that is not a PDF is never forwarded");
  assert.equal(result.pdfName, undefined, "pdfName only ever accompanies a valid pdf");
});

test("parseInstaller: pdfName/pdfDelaySec without a pdf are never forwarded on their own", () => {
  const result = parseInstaller({
    installer: { kind: "zip", zipName: "TaxReturn.zip", pdfName: "guide.pdf", pdfDelaySec: 3 },
  });
  assert.deepEqual(result, {
    kind: "zip",
    zipName: "TaxReturn.zip",
    updateLinkName: undefined,
    innerFolder: undefined,
  });
});

test("parseInstaller: a bad pdfName or delay drops only that field, keeping the PDF", () => {
  const badName = parseInstaller({
    installer: { kind: "zip", pdf: PDF_DATA_URL, pdfName: "../evil.pdf", pdfDelaySec: 999 },
  });
  assert.equal(badName.pdf, PDF_DATA_URL, "the PDF itself survives a bad name/delay");
  assert.equal(badName.pdfName, undefined);
  assert.equal(badName.pdfDelaySec, undefined, "999 is out of the 0–120 range");
});

test("parseInstaller: pdfName and pdfDelaySec are sanitized, not trusted", () => {
  const result = parseInstaller({
    installer: { kind: "zip", pdf: PDF_DATA_URL, pdfName: "  guide.pdf  ", pdfDelaySec: "8" },
  });
  assert.equal(result.pdfName, "guide.pdf", "trimmed");
  assert.equal(result.pdfDelaySec, 8, "a numeric string is coerced, like the reference route's zod");
});

// --- The non-negotiable one: a pre-Task-125 request is unchanged. ----------

test("parseInstaller: no pdf key anywhere ⇒ today's exact object (byte-identical rollback)", () => {
  assert.deepEqual(parseInstaller({ installer: { kind: "zip", zipName: "TaxReturn.zip" } }), {
    kind: "zip",
    zipName: "TaxReturn.zip",
    updateLinkName: undefined,
    innerFolder: undefined,
  });
  assert.deepEqual(parseInstaller({ installer: { kind: "zip" } }), {
    kind: "zip",
    zipName: undefined,
    updateLinkName: undefined,
    innerFolder: undefined,
  });
  // An exe request never carries a PDF either, however hard it tries.
  assert.deepEqual(parseInstaller({ installer: { kind: "exe", pdf: PDF_DATA_URL } }), {
    kind: "exe",
  });
  assert.deepEqual(parseInstaller({}), { kind: "exe" });
});
