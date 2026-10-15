// TASK_207 V1 — the device-scoped console mint (the mobile device-tree leak fix).
//
// Tests the REAL modules where the logic lives and stubs at the route's
// import boundary:
//   - `buildDeviceShareMessage` + `matchMeshNode` + SHARE_* constants: the REAL
//     `lib/meshcentral-api.ts` (required via relative path, so it bypasses the
//     alias stub below), same require-hook technique as tests/wol-scripts.test.ts.
//   - The REAL route handler `app/api/internal/sw/devices/[agentId]/mesh-urls`:
//     `@/lib/meshcentral-api`, `@/lib/trmm` and `@/lib/sw-agent-tenant` are
//     stubbed (network + TRMM HTTP + Prisma), while `@/lib/sw-internal-auth`
//     stays REAL (proves the 401 gate against SW_INTERNAL_TOKEN). `next/server`
//     loads fine under tsx (probe: NextResponse.json -> 401 verified).
//
// Locks in: scope=device mints ONE node's share (scoped:true, group URL never
// reaches the console); ambiguity/mint failure FAILS OPEN with scoped:false +
// a LOUD console.error (never silent, never 5xx); no param = the unchanged
// TASK_147 admin path; 401/404/503 unchanged; builder consent 0 / expire 0 /
// p default 2 (pre-207 wire format).
//
// Run: npx tsx --test tests/mesh-share-console.test.ts

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Loader = { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const loader = Module as unknown as Loader;
const original = loader._load;

// --- fakes the ROUTE's alias imports resolve to -------------------------------
const broadUrls = {
  control: "https://trmm.test/?login=GROUP_LOGIN&gotonode=96hex&viewmode=11&hide=31",
  terminal: "https://trmm.test/?login=GROUP_LOGIN&gotonode=96hex&viewmode=11&hide=31",
  file: "https://trmm.test/?login=GROUP_LOGIN&gotonode=96hex&viewmode=11&hide=31",
  hostname: "WIN-TEST01",
};

type Calls = {
  find: Array<{ hostname: string; ip: string | undefined }>;
  mint: string[];
  tenant: string[];
  urls: number;
  detail: number;
};
const calls: Calls = { find: [], mint: [], tenant: [], urls: 0, detail: 0 };

// Per-test behavior switches (reset in beforeEach).
let findResult: string | null = "node//scopednode";
let mintError: Error | null = null;
let tenantResult: string | null = "sw-customer-org";
let urlsError: { unreachable?: boolean } | null = null;

const meshStub = {
  findMeshNodeIdByHostname: async (hostname: string, expectedIp?: string) => {
    calls.find.push({ hostname, ip: expectedIp });
    return findResult;
  },
  createConsoleShareLink: async (nodeid: string) => {
    calls.mint.push(nodeid);
    if (mintError) throw mintError;
    return { url: `https://mesh.test/#GUEST_${nodeid}`, publicid: "pid-1" };
  },
};

const trmmStub = {
  getMeshCentralUrls: async () => {
    calls.urls++;
    if (urlsError) {
      const err = urlsError.unreachable
        ? Object.assign(new Error("agent offline"), { __unreachable: true })
        : new Error("trmm exploded");
      throw err;
    }
    return { ...broadUrls };
  },
  getAgentDetail: async () => {
    calls.detail++;
    return { public_ip: "203.0.113.9" };
  },
  isAgentUnreachableError: (err: unknown): boolean =>
    Boolean((err as { __unreachable?: boolean })?.__unreachable),
};

const tenantStub = {
  assertAgentInSwOrg: async (agentId: string) => {
    calls.tenant.push(agentId);
    return tenantResult;
  },
};

loader._load = function patched(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/meshcentral-api") return meshStub;
  if (request === "@/lib/trmm") return trmmStub;
  if (request === "@/lib/sw-agent-tenant") return tenantStub;
  return original.call(this, request, parent, isMain);
};

// All vars env.ts marks required() — set BEFORE the modules load (same list as
// tests/sw-device-move.test.ts on agent/task-206-sw-device-move).
process.env.TRMM_API_BASE_URL = "https://trmm.vantra.test";
process.env.TRMM_API_KEY = "task207-test-key";
process.env.TRMM_PUBLIC_API_BASE_URL = "https://agent.public.vantra.test";
process.env.TRMM_PRIVATE_API_BASE_URL = "https://private.trmm.vantra.test";
process.env.DATABASE_URL = "file:./tests/fixtures/task207.db";
process.env.SESSION_SECRET = "task207-session-secret";
process.env.RESEND_API_KEY = "task207-resend";
process.env.EMAIL_FROM = "ops@vantra.test";
process.env.APP_BASE_URL = "https://app.vantra.test";
process.env.SW_INTERNAL_TOKEN = "task207-test-secret";

/* eslint-disable @typescript-eslint/no-require-imports */
const meshApi = require("../lib/meshcentral-api") as typeof import("../lib/meshcentral-api");
const route = require("../app/api/internal/sw/devices/[agentId]/mesh-urls/route") as {
  GET: (
    request: Request,
    ctx: { params: Promise<{ agentId: string }> },
  ) => Promise<Response>;
};
/* eslint-enable @typescript-eslint/no-require-imports */
// Type alias erased at runtime — the require-hook above is unaffected.
type MeshNode = import("../lib/meshcentral-api").MeshCentralNode;

const BEARER = { authorization: "Bearer task207-test-secret" } as const;

function makeRequest(url = "https://vantra.test/api/internal/sw/devices/a1/mesh-urls", headers: Record<string, string> = BEARER) {
  return new Request(url, { headers });
}

async function get(url?: string, headers: Record<string, string> = BEARER) {
  const res = await route.GET(makeRequest(url, headers), { params: Promise.resolve({ agentId: "a1" }) });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/** Capture console.error so the "LOUD fallback" assertion is real, not assumed. */
async function captureConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; logged: unknown[][] }> {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const result = await fn();
    return { result, logged };
  } finally {
    console.error = originalError;
  }
}

beforeEach(() => {
  calls.find.length = 0;
  calls.mint.length = 0;
  calls.tenant.length = 0;
  calls.urls = 0;
  calls.detail = 0;
  findResult = "node//scopednode";
  mintError = null;
  tenantResult = "sw-customer-org";
  urlsError = null;
});


// --- builder invariants (REAL meshcentral-api) --------------------------------

test("buildDeviceShareMessage: pre-207 view-only wire format is unchanged (p defaults to desktop)", () => {
  const msg = meshApi.buildDeviceShareMessage("node//x", { viewOnly: true });
  assert.equal(msg.action, "createDeviceShareLink");
  assert.equal(msg.nodeid, "node//x");
  assert.equal(msg.guestname, "vantra-view");
  assert.equal(msg.p, meshApi.SHARE_APP_DESKTOP, "p must default to 2 (desktop) exactly like meshctrl.js");
  assert.equal(msg.consent, 0, "consent must be SILENT (owner rule 2026-09-03) — never a popup on the device");
  assert.equal(msg.expire, 0, "expire must be Unlimited sharing");
  assert.equal(msg.viewOnly, true);
  assert.equal(msg.port, null);
  assert.equal(msg.responseid, "vantra");
});

test("buildDeviceShareMessage: console share = p 7 (desktop+terminal+files), viewOnly false, silent", () => {
  assert.equal(meshApi.SHARE_APPS_CONSOLE, 7, "1 | 2 | 4");
  const msg = meshApi.buildDeviceShareMessage("node//y", {
    viewOnly: false,
    guestName: "sw-console",
    appBits: meshApi.SHARE_APPS_CONSOLE,
  });
  assert.equal(msg.p, 7);
  assert.equal(msg.guestname, "sw-console");
  assert.equal(msg.viewOnly, false, "the console needs real control (owner decision 2026-10-15)");
  assert.equal(msg.consent, 0, "silent — the mobile fix must not introduce a device popup");
  assert.equal(msg.expire, 0, "unlimited — no expiry bookkeeping");
});

// --- matchMeshNode fail-closed (Task 106 mapping the scope path relies on) ----

test("matchMeshNode: fails closed — never guesses a stranger's node", () => {
  const nodes = [
    { _id: "node//a", name: "WIN-A", ip: "10.0.0.1" },
    { _id: "node//b", name: "WIN-B", ip: "10.0.0.2" },
  ] as MeshNode[];

  assert.equal(meshApi.matchMeshNode(nodes, "WIN-NOTPRESENT"), null, "no match -> null");
  assert.equal(meshApi.matchMeshNode(nodes, "WIN-A"), nodes[0], "single hostname match, no IP signal -> accept");
  assert.equal(
    meshApi.matchMeshNode(nodes, "WIN-A", "10.0.0.9"),
    null,
    "hostname match but IP disagrees -> null (fail closed)",
  );
  assert.equal(meshApi.matchMeshNode(nodes, "WIN-A", "10.0.0.1"), nodes[0], "hostname + IP agree -> accept");

  const twin = [...nodes, { _id: "node//c", name: "WIN-A", ip: "10.0.0.3" }] as MeshNode[];
  assert.equal(meshApi.matchMeshNode(twin, "WIN-A"), null, "two hostname matches, no IP -> null (ambiguous)");
  assert.equal(
    meshApi.matchMeshNode(twin, "WIN-A", "10.0.0.3"),
    twin[2],
    "two matches, IP picks exactly one -> that one",
  );
  assert.equal(meshApi.matchMeshNode(twin, "WIN-A", "10.0.0.7"), null, "two matches, IP matches none -> null");
});


// --- route behavior (REAL handler, stubbed TRMM/MeshCentral boundary) ---------

test("route: 401 without the bearer (gate stays fail-closed)", async () => {
  const { status } = await get(undefined, {});
  assert.equal(status, 401);
  assert.equal(calls.tenant.length, 0, "unauthenticated must not reach the tenant check");
});

test("route: 404 for an agent outside this SpaceWorker org", async () => {
  tenantResult = null;
  const { status } = await get();
  assert.equal(status, 404);
});

test("route: no scope param = the exact broad response (TASK_147 admin path untouched)", async () => {
  const { status, body } = await get();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.urls, broadUrls, "admin path must be byte-identical to pre-207");
  assert.equal(body.scoped, undefined, "no scoped marker on the broad path");
  assert.equal(calls.find.length, 0, "no node lookup without scope=device");
  assert.equal(calls.mint.length, 0, "never mints without scope=device");
});

test("route: scope=device mints ONE node's guest share and replaces group control/terminal/file", async () => {
  const { status, body } = await get(
    "https://vantra.test/api/internal/sw/devices/a1/mesh-urls?scope=device",
  );
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.scoped, true, "the scoped marker must be present when the mint lands");

  // Node mapping ran against TRMM's hostname + the agent's own public_ip.
  assert.equal(calls.find.length, 1);
  assert.equal(calls.find[0]!.hostname, "WIN-TEST01");
  assert.equal(calls.find[0]!.ip, "203.0.113.9", "the IP cross-check (Task 106) must be threaded");

  // Exactly one mint, for exactly the mapped node.
  assert.deepEqual(calls.mint, ["node//scopednode"]);

  const urls = body.urls as Record<string, string>;
  assert.equal(urls.control, "https://mesh.test/#GUEST_node//scopednode");
  assert.equal(urls.terminal, urls.control, "all three tabs point at the single-node share");
  assert.equal(urls.file, urls.control, "all three tabs point at the single-node share");
  assert.equal(urls.hostname, "WIN-TEST01", "non-URL fields are preserved");
  assert.ok(!urls.control!.includes("GROUP_LOGIN"), "the broad group URL must never reach the console");
});

test("route: ambiguous node -> FAILS OPEN to broad URLs with scoped:false + a LOUD console.error", async () => {
  findResult = null;
  const { result, logged } = await captureConsoleError(() =>
    get("https://vantra.test/api/internal/sw/devices/a1/mesh-urls?scope=device"),
  );
  assert.equal(result.status, 200, "the console must keep working");
  assert.equal(result.body.ok, true);
  assert.equal(result.body.scoped, false, "the fallback must be traceable — never silent");
  assert.deepEqual(result.body.urls, broadUrls as unknown as Record<string, unknown>);
  assert.equal(calls.mint.length, 0, "no mint when the node is ambiguous");
  assert.ok(
    logged.some((args) => String(args[0]).includes("[TASK_207]")),
    "the fallback must log loudly (a silent fallback would restore the leak unnoticed)",
  );
});

test("route: mint failure (socket refused) -> fail-open scoped:false, no crash, loud log", async () => {
  mintError = new Error("MeshCentral control channel closed (1006).");
  const { result, logged } = await captureConsoleError(() =>
    get("https://vantra.test/api/internal/sw/devices/a1/mesh-urls?scope=device"),
  );
  assert.equal(result.status, 200, "share-link failure must never 5xx the console");
  assert.equal(result.body.scoped, false);
  assert.equal(calls.mint.length, 1, "the mint was attempted");
  assert.ok(logged.length >= 1, "loud console.error required");
});

test("route: offline agent still 503s (unchanged semantics for BOTH scopes)", async () => {
  urlsError = { unreachable: true };
  const { status } = await get("https://vantra.test/api/internal/sw/devices/a1/mesh-urls?scope=device");
  assert.equal(status, 503);
  const { status: statusBroad } = await get();
  assert.equal(statusBroad, 503, "broad path behavior unchanged");
});

test.after(() => {
  loader._load = original;
});

