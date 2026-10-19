// TASK_230 Section A.5 — instance-aware mesh host (lib/mesh-instance.ts).
//
// Pure module (no server-only / env / db) — same test posture as
// tests/install-link-zip.test.ts. Run:
//   npx tsx --test tests/mesh-instance.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MESH_PUBLIC_HOST,
  MESH_PRIVATE_HOST,
  isPrivateSwOrg,
  meshHostForOrg,
  resolvePrivateMeshHost,
  rewriteMeshUrlHost,
  applyMeshInstance,
} from "../lib/mesh-instance";

// --- org discriminant ------------------------------------------------------

test("isPrivateSwOrg: sw-<uid>-p is private", () => {
  assert.equal(isPrivateSwOrg("sw-abc123-p"), true);
});

test("isPrivateSwOrg: public sw-<uid> is not private", () => {
  assert.equal(isPrivateSwOrg("sw-abc123"), false);
});

test("isPrivateSwOrg: a name merely ending in -p without sw- prefix is not private", () => {
  assert.equal(isPrivateSwOrg("acme-p"), false);
});

test("isPrivateSwOrg: empty / unrelated org names are not private", () => {
  assert.equal(isPrivateSwOrg(""), false);
  assert.equal(isPrivateSwOrg("acme-corp"), false);
});

test("meshHostForOrg: private companion DEFAULTS to instance A (B3.1 fallback)", () => {
  // ⛔ DEPLOY-BLOCKER PIN (owner, §B3.1): no nodes exist on B yet, so the
  // default private target MUST be A — minting private->broks repeats the
  // outage where every private device's remote control died (xid={}).
  assert.equal(meshHostForOrg("sw-abc123-p"), MESH_PUBLIC_HOST);
  assert.equal(meshHostForOrg("sw-abc123-p"), "mesh.instaweb.top");
});

test("meshHostForOrg: private companion -> B only when config explicitly says so", () => {
  // The box owner flips MESH_PRIVATE_HOST to broks at node migration.
  assert.equal(meshHostForOrg("sw-abc123-p", MESH_PRIVATE_HOST), MESH_PRIVATE_HOST);
  assert.equal(MESH_PRIVATE_HOST, "mesh.broks.beauty");
});

test("meshHostForOrg: public sw org always resolves to instance A (today's host)", () => {
  assert.equal(meshHostForOrg("sw-abc123"), MESH_PUBLIC_HOST);
  assert.equal(MESH_PUBLIC_HOST, "mesh.instaweb.top");
  // Even a (nonsensical) broks private-host config never redirects a PUBLIC org.
  assert.equal(meshHostForOrg("sw-abc123", MESH_PRIVATE_HOST), MESH_PUBLIC_HOST);
});

test("meshHostForOrg: non-sw org names resolve to public A (single-instance behavior)", () => {
  assert.equal(meshHostForOrg("acme-corp"), MESH_PUBLIC_HOST);
});

// --- private-host config resolution (B3.1 fallback) ------------------------

test("resolvePrivateMeshHost: unset/blank/whitespace -> safe default A", () => {
  assert.equal(resolvePrivateMeshHost(undefined), MESH_PUBLIC_HOST);
  assert.equal(resolvePrivateMeshHost(null), MESH_PUBLIC_HOST);
  assert.equal(resolvePrivateMeshHost(""), MESH_PUBLIC_HOST);
  assert.equal(resolvePrivateMeshHost("   "), MESH_PUBLIC_HOST);
});

test("resolvePrivateMeshHost: exact broks value -> B (post-migration flip)", () => {
  assert.equal(resolvePrivateMeshHost("mesh.broks.beauty"), MESH_PRIVATE_HOST);
});

test("resolvePrivateMeshHost: explicit instaweb -> A (no-op, valid value)", () => {
  assert.equal(resolvePrivateMeshHost("mesh.instaweb.top"), MESH_PUBLIC_HOST);
});

test("resolvePrivateMeshHost: ANY foreign/typo value -> A, never B, never arbitrary", () => {
  assert.equal(resolvePrivateMeshHost("evil.example.com"), MESH_PUBLIC_HOST);
  assert.equal(resolvePrivateMeshHost("Mesh.Broks.Beauty"), MESH_PUBLIC_HOST, "case-sensitive");
  assert.equal(resolvePrivateMeshHost("https://mesh.broks.beauty"), MESH_PUBLIC_HOST, "no scheme");
  assert.equal(resolvePrivateMeshHost("mesh.broks.beauty."), MESH_PUBLIC_HOST, "no trailing dot");
  // Surrounding whitespace IS tolerated (env vars often carry it) — trimmed
  // before the exact-match check, so this resolves to B like the bare value.
  assert.equal(resolvePrivateMeshHost("  mesh.broks.beauty \n"), MESH_PRIVATE_HOST);
});

// --- single-URL rewrite ----------------------------------------------------

test("rewriteMeshUrlHost: A host -> B host, scheme/port/path/query kept", () => {
  assert.equal(
    rewriteMeshUrlHost(
      "wss://mesh.instaweb.top/control.ashx?auth=abc%24def",
      MESH_PRIVATE_HOST,
    ),
    "wss://mesh.broks.beauty/control.ashx?auth=abc%24def",
  );
});

test("rewriteMeshUrlHost: same host round-trips byte-identical (public no-op)", () => {
  const url = "https://mesh.instaweb.top/#theme";
  assert.equal(rewriteMeshUrlHost(url, MESH_PUBLIC_HOST), url);
});

test("rewriteMeshUrlHost: unknown host is never touched", () => {
  const url = "https://example.com/control.ashx";
  assert.equal(rewriteMeshUrlHost(url, MESH_PRIVATE_HOST), url);
});

test("rewriteMeshUrlHost: non-URL input passes through unchanged", () => {
  assert.equal(rewriteMeshUrlHost("not a url", MESH_PRIVATE_HOST), "not a url");
  assert.equal(rewriteMeshUrlHost("", MESH_PRIVATE_HOST), "");
});

test("rewriteMeshUrlHost: explicit port survives the host swap", () => {
  assert.equal(
    rewriteMeshUrlHost("https://mesh.instaweb.top:8443/x", MESH_PRIVATE_HOST),
    "https://mesh.broks.beauty:8443/x",
  );
});

// --- full payload rewrite --------------------------------------------------

function sampleUrls() {
  return {
    hostname: "DESKTOP-XYZ", // device machine name — must NEVER be rewritten
    control: "wss://mesh.instaweb.top/control.ashx?auth=tok",
    terminal: "https://mesh.instaweb.top/term.html?id=1",
    file: "https://mesh.instaweb.top/filetransfer.html?id=1",
    status: "https://mesh.instaweb.top/status",
    client: "https://mesh.instaweb.top/client",
    site: "wss://mesh.instaweb.top",
  };
}

test("applyMeshInstance: private org (B configured) rewrites every host-bearing field to B", () => {
  const out = applyMeshInstance(sampleUrls(), "sw-abc123-p", MESH_PRIVATE_HOST);
  assert.equal(out.control, "wss://mesh.broks.beauty/control.ashx?auth=tok");
  assert.equal(out.terminal, "https://mesh.broks.beauty/term.html?id=1");
  assert.equal(out.file, "https://mesh.broks.beauty/filetransfer.html?id=1");
  assert.equal(out.status, "https://mesh.broks.beauty/status");
  assert.equal(out.client, "https://mesh.broks.beauty/client");
  assert.equal(out.site, "wss://mesh.broks.beauty");
});

test("applyMeshInstance: private org WITHOUT config stays on A (B3.1 fallback)", () => {
  // ⛔ Deploy-blocker pin: default private mint must NOT leave instance A.
  const input = sampleUrls();
  assert.deepEqual(applyMeshInstance(input, "sw-abc123-p"), input);
  assert.equal(applyMeshInstance(input, "sw-abc123-p").control,
    "wss://mesh.instaweb.top/control.ashx?auth=tok");
});

test("applyMeshInstance: private org NEVER touches hostname (view-only node lookup)", () => {
  const out = applyMeshInstance(sampleUrls(), "sw-abc123-p", MESH_PRIVATE_HOST);
  assert.equal(out.hostname, "DESKTOP-XYZ");
});

test("applyMeshInstance: public org round-trips byte-identical (A -> A)", () => {
  const input = sampleUrls();
  assert.deepEqual(applyMeshInstance(input, "sw-abc123"), input);
});

test("applyMeshInstance: input object is not mutated", () => {
  const input = sampleUrls();
  applyMeshInstance(input, "sw-abc123-p", MESH_PRIVATE_HOST);
  assert.equal(input.control, "wss://mesh.instaweb.top/control.ashx?auth=tok");
});

test("applyMeshInstance: absent optional fields don't throw", () => {
  const out = applyMeshInstance<Record<string, string | undefined>>(
    { hostname: "X" },
    "sw-abc123-p",
  );
  assert.equal(out.hostname, "X");
  assert.equal(out.control, undefined);
});

test("applyMeshInstance: a foreign host in a field survives (only known mesh hosts swap)", () => {
  const out = applyMeshInstance(
    { control: "wss://other.example.com/control.ashx" },
    "sw-abc123-p",
    MESH_PRIVATE_HOST,
  );
  assert.equal(out.control, "wss://other.example.com/control.ashx");
});
