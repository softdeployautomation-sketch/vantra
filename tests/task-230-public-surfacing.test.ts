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

// --- sw/devices route pins (surfacing) --------------------------------------

test("sw/devices surfaces mesh nodes ONLY for the public org", () => {
  assert.match(devicesSrc, /isSwPublicOrgName\(org\.name\)/);
  // private companion must never reach the mesh path
  assert.ok(!/agentDomainTier === .private.[\s\S]{0,400}listPublicMeshDeviceRows/.test(devicesSrc));
});

test("sw/devices mesh row keys by node id (`node//`) — the free mesh discriminator", () => {
  assert.match(devicesSrc, /vantraAgentId: node\._id/);
  assert.match(devicesSrc, /meshOnly: true/); // additive flag for tests/clarity
});

test("sw/devices: online = conn === 1, honest lastSeen (undefined when offline)", () => {
  assert.match(devicesSrc, /node\.conn === 1/);
  assert.match(devicesSrc, /lastSeen: online \? new Date\(\)\.toISOString\(\) : undefined/);
});

test("sw/devices: mesh surfacing is FIND-ONLY (no group creation on GET)", () => {
  assert.match(devicesSrc, /listMeshGroups/); // find, not ensure/create
  assert.ok(!/ensureMeshGroupByName/.test(devicesSrc), "GET must not create a group");
});

test("sw/devices: mesh path fails soft (never blanks the TRMM half)", () => {
  assert.match(devicesSrc, /listPublicMeshDeviceRows/);
  assert.match(devicesSrc, /return \[\]; \/\/ MeshCentral unreachable/);
  assert.match(devicesSrc, /if \(!groupId\) return \[\]/);
});

// --- install-link route pins (per-user group at install) --------------------

test("install-link mesh branch uses the PER-USER group, derived from org.name", () => {
  assert.match(installSrc, /swUserIdFromOrgName\(org\.name\)/);
  assert.match(installSrc, /swPublicMeshGroupName\(uid\)/);
  assert.ok(!/ensureMeshGroupByName\(SW_PUBLIC_MESH_GROUP_NAME\)/.test(installSrc));
});

test("install-link mesh branch FAILS CLOSED on unattributable org (400)", () => {
  assert.match(installSrc, /Unattributable org name/);
  assert.match(installSrc, /status: 400/);
});

test("install-link mesh branch still creates NO tactical artifact (P3 pin)", () => {
  // the mesh block sits before any createDeployment call and returns its own
  // command — a mesh-only install never mints a TRMM deployment.
  const meshIdx = installSrc.indexOf("wantsMeshStandalone");
  const deployIdx = installSrc.indexOf("createDeployment(");
  assert.ok(meshIdx > 0 && deployIdx > 0 && meshIdx < deployIdx);
});
