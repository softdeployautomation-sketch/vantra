// TASK_206 (V1) — the Vantra internal move route's engine.
//
// Tests the REAL lib modules (not copies): `moveAgentToSite`'s new
// `opts.skipReconfigure` (the OFFLINE / server-side-only move SpaceWorker's
// onboarding flow uses to release a device that went offline mid-migration),
// and `moveDeviceToPrivate`'s threading of that opt through
// assertPublicMoveSource -> resolveMoveDestination -> moveAgentToSite. Loaded
// through the same require hook as tests/wol-scripts.test.ts: `server-only` is
// stubbed (throws outside Next's build) and `./db` is stubbed (no SQLite). TRMM's
// own HTTP (`trmm()` uses global fetch) is stubbed by swapping
// `globalThis.fetch`, so `reassignAgentSite`'s PUT + its `getAgentDetail` verify
// pass with no network and no device. The on-device `runCommand` is INJECTED and
// counted — exactly how we prove skipReconfigure never touches the box.
//
// Run: npx tsx --test tests/sw-device-move.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Loader = { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const loader = Module as unknown as Loader;
const original = loader._load;

// Minimal in-memory `db` stub — only `organization.findUnique` (the exact call
// resolveMoveDestination + assertPublicMoveSource make) is needed here.
type OrgRow = { id: string; name: string; agentDomainTier: string; trmmSiteId: number | null };
const orgs: Record<string, OrgRow | null> = {};
const dbStub = {
  organization: {
    findUnique: async (args: { where: { id: string } }) => orgs[args.where.id] ?? null,
  },
};

loader._load = function patched(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "./db") return { db: dbStub };
  return original.call(this, request, parent, isMain);
};

// All vars env.ts marks required() — must be set BEFORE the modules load.
process.env.TRMM_API_BASE_URL = "https://trmm.vantra.test";
process.env.TRMM_API_KEY = "task206-test-key";
process.env.TRMM_PUBLIC_API_BASE_URL = "https://agent.public.vantra.test";
process.env.TRMM_PRIVATE_API_BASE_URL = "https://private.trmm.vantra.test";
process.env.DATABASE_URL = "file:./tests/fixtures/task206.db";
process.env.SESSION_SECRET = "task206-session-secret";
process.env.RESEND_API_KEY = "task206-resend";
process.env.EMAIL_FROM = "ops@vantra.test";
process.env.APP_BASE_URL = "https://app.vantra.test";

/* eslint-disable @typescript-eslint/no-require-imports */
const trmm = require("../lib/trmm") as typeof import("../lib/trmm");
const deviceMove = require("../lib/device-move") as typeof import("../lib/device-move");
/* eslint-enable @typescript-eslint/no-require-imports */

// Stub global fetch so reassignAgentSite's PUT + getAgentDetail verify succeed
// with no network: PUT /agents/:id/ -> {} (reassign); GET -> { site_id } that
// matches the reassigned site so the verify read-back passes.
const realFetch = globalThis.fetch;
function installFetch(opts: { reassignOk?: boolean; siteId?: number } = {}) {
  const reassignOk = opts.reassignOk !== false;
  const siteId = opts.siteId ?? 7;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      return new Response(reassignOk ? JSON.stringify({}) : "nope", {
        status: reassignOk ? 200 : 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ agent_id: "a1", site_id: siteId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

test("moveAgentToSite skipReconfigure: reassign lands, on-device reconfigure is SKIPPED (runCommand never called)", async () => {
  installFetch({ siteId: 7 });
  let runCommandCalls = 0;
  const result = await trmm.moveAgentToSite(
    "agent-1",
    { siteId: 7, apiBaseUrl: "https://private.trmm.vantra.test" },
    async () => {
      runCommandCalls++;
      return "MOVE_OK";
    },
    { skipReconfigure: true },
  );
  assert.equal(runCommandCalls, 0, "skipReconfigure must never run a command on the device");
  assert.equal(result.reassign.ok, true, "the server-side reassign must have landed");
  assert.equal(result.reconfigure.ok, true);
  assert.equal(result.reconfigure.skipped, true, "reconfigure must report skipped");
  assert.equal(result.ok, true);
});

test("moveAgentToSite default path still runs the on-device reconfigure (skipped=false)", async () => {
  installFetch({ siteId: 7 });
  let runCommandCalls = 0;
  const result = await trmm.moveAgentToSite(
    "agent-1",
    { siteId: 7, apiBaseUrl: "https://private.trmm.vantra.test" },
    async () => {
      runCommandCalls++;
      return "MOVE_OK base=https://private.trmm.vantra.test";
    },
  );
  assert.equal(runCommandCalls, 1, "the full move must run reconfigure exactly once");
  assert.equal(result.reconfigure.ok, true);
  assert.equal(result.reconfigure.skipped, false);
  assert.equal(result.ok, true);
});

test("moveAgentToSite: a failed reassign short-circuits before reconfigure, even with skipReconfigure", async () => {
  installFetch({ reassignOk: false });
  let runCommandCalls = 0;
  const result = await trmm.moveAgentToSite(
    "agent-1",
    { siteId: 7, apiBaseUrl: "https://private.trmm.vantra.test" },
    async () => {
      runCommandCalls++;
      return "MOVE_OK";
    },
    { skipReconfigure: true },
  );
  assert.equal(result.reassign.ok, false, "the reassign failed");
  assert.equal(result.reconfigure.skipped, true, "reconfigure was never attempted");
  assert.equal(result.ok, false);
  assert.equal(runCommandCalls, 0, "no command runs when reassign fails");
});

test("moveDeviceToPrivate threads skipReconfigure through assert/reassign -> moveAgentToSite", async () => {
  // Source org = public tier; destination org = private tier + provisioned site.
  orgs["src-org"] = { id: "src-org", name: "sw-uid", agentDomainTier: "public", trmmSiteId: 1 };
  orgs["dst-org"] = { id: "dst-org", name: "sw-uid-p", agentDomainTier: "private", trmmSiteId: 7 };
  installFetch({ siteId: 7 });
  let runCommandCalls = 0;
  const result = await deviceMove.moveDeviceToPrivate("agent-1", "src-org", "dst-org", async () => {
    runCommandCalls++;
    return "MOVE_OK";
  }, { skipReconfigure: true });
  assert.equal(runCommandCalls, 0, "skipReconfigure threaded through moveDeviceToPrivate -> no on-device cmd");
  assert.equal(result.ok, true);
  assert.equal(result.reassign.ok, true);
  assert.equal(result.reconfigure.skipped, true);
});

test("moveDeviceToPrivate rejects a non-private destination (direction guard still enforced)", async () => {
  orgs["src-org"] = { id: "src-org", name: "sw-uid", agentDomainTier: "public", trmmSiteId: 1 };
  orgs["public-dst"] = { id: "public-dst", name: "sw-uid2-p", agentDomainTier: "public", trmmSiteId: 7 };
  await assert.rejects(
    deviceMove.moveDeviceToPrivate("agent-1", "src-org", "public-dst", async () => "MOVE_OK"),
    /private/i,
  );
});

test.after(() => {
  globalThis.fetch = realFetch;
  loader._load = original;
});

