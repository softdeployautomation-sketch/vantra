// TASK_230 Section A (deliverables 2+3 groundwork) — attribution + surfacing.
// Pure-module tests for the uid/group helpers + static pins on the two server
// routes (sw/devices surfacing; install-link per-user group). Run:
//   npx tsx --test tests/task-230-public-surfacing.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SW_PUBLIC_MESH_GROUP_NAME,
  swPublicMeshGroupName,
} from "../lib/mesh-standalone-install";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip // line comments — prose legitimately names retired symbols. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const devicesSrc = read("app/api/internal/sw/devices/route.ts");
const installSrc = read("app/api/internal/sw/orgs/[orgId]/install-link/route.ts");
// Code-only (comments stripped) for the "no mesh reference" pins — prose
// legitimately names the retired path ("No mesh, no TRMM manual installer").
const installCode = codeOnly(installSrc);
const serviceSrc = codeOnly(read("lib/spaceworker-service.ts"));

// --- uid derivation (org.name → SpaceWorker user id). spaceworker-service is
//     server-only, so these assert the SHIPPED source (task-230-move-flow precedent).

test("swUserIdFromOrgName: strips `sw-` prefix and trailing `-p` companion", () => {
  assert.match(serviceSrc, /export function swUserIdFromOrgName/);
  assert.match(serviceSrc, /body\.endsWith\("-p"\) \? body\.slice\(0, -"-p"\.length\) : body/);
  assert.match(serviceSrc, /uid\.length > 0 \? uid : null/); // empty uid → null (fail closed)
});

test("isSwPublicOrgName: public = sw- prefix AND not ending `-p`", () => {
  assert.match(serviceSrc, /export function isSwPublicOrgName/);
  assert.match(serviceSrc, /isSwOrgName\(name\) && !name\.slice\(SW_ORG_PREFIX\.length\)\.endsWith\("-p"\)/);
});

// --- per-user public mesh group name (PURE — direct import) -----------------

test("swPublicMeshGroupName: per-user, distinct per uid, prefixed by shared const", () => {
  const a = swPublicMeshGroupName("userA");
  const b = swPublicMeshGroupName("userB");
  assert.equal(a, `${SW_PUBLIC_MESH_GROUP_NAME} · userA`);
  assert.notEqual(a, b); // attribution requires per-user uniqueness
  assert.ok(a.startsWith(SW_PUBLIC_MESH_GROUP_NAME));
});

test("P3 shared constant still exists (fallback / pre-230 installs)", () => {
  assert.equal(SW_PUBLIC_MESH_GROUP_NAME, "SpaceWorker Public");
});

// --- sw/devices route pins (surfacing) — 2026-10-22: public-mesh RETIRED ----
// Public devices are Everwas-only now. The old `SpaceWorker Public · <uid>`
// mesh path was the source of "device resurrects as public after the private
// agent is removed" (a leftover public mesh node re-surfaced the machine on
// the next sync). The route must NOT query MeshCentral or emit mesh rows.

test("sw/devices does NOT surface mesh nodes (public-mesh retired)", () => {
  assert.ok(!/listMeshGroups|listPublicMeshDeviceRows|meshNodeToDeviceRow/.test(devicesSrc),
    "devices route must not query MeshCentral for public mesh rows");
  assert.ok(!/meshcentral-api/.test(devicesSrc), "no MeshCentral import in the devices route");
  assert.ok(!/meshOnly/.test(devicesSrc), "no meshOnly rows emitted");
});

test("sw/devices serves only TRMM + Everwas rows", () => {
  assert.match(devicesSrc, /engine: "trmm" as const/);
  assert.match(devicesSrc, /devices: \[\.\.\.trmmRows, \.\.\.everwasRows\]/);
  assert.ok(!/\.\.\.meshRows/.test(devicesSrc), "meshRows must not be concatenated");
});

test("sw/devices returns orgTier (public/private) for the consumer", () => {
  assert.match(devicesSrc, /orgTier: org\.agentDomainTier/);
});

// --- install-link route pins — 2026-10-22: public = Everwas-only, no mesh ---
// The public tier mints an Everwas site-scoped enrollment (no mesh group, no
// TRMM manual installer). The private tier returns the PowerShell-native
// install command against the private agent API base. Neither creates a
// SpaceWorker Public mesh group.

test("install-link public branch is Everwas-only (no mesh, no TRMM installer)", () => {
  assert.ok(!/mesh|MeshCentral|swPublicMeshGroupName|ensureMeshGroupByName/.test(installCode),
    "install-link must not reference the public mesh path");
  assert.match(installSrc, /tier: "public"/);
  assert.match(installSrc, /provider: "everwas"/);
  assert.match(installSrc, /createSite|everwasSiteId/);
});

test("install-link private branch returns the PowerShell command against the private API base", () => {
  assert.match(installSrc, /isPrivateTier/);
  assert.match(installSrc, /createManualInstaller/);
  assert.match(installSrc, /tier: "private"/);
  assert.match(installSrc, /command: manual\.psCommand/);
});

test("install-link mints Everwas site on first request and caches it on the org", () => {
  assert.match(installSrc, /everwasSiteId/);
  assert.match(installSrc, /findOrCreateDeployment/);
});
