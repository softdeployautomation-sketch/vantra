// TASK_230 A.2 — the /runmesh route (hide-via-mesh transport) + the pure wire
// helpers in meshcentral-api / mesh-standalone-install. The route imports
// server-only libs (ws/env), so — following tests/task-230-move-flow.test.ts
// (pins) and SpaceWorker's tests/device-onboarding.test.ts (loader hook) — the
// MeshCentral + auth modules are intercepted and the REAL handler is executed.
// Run: npx tsx --test tests/task-230-runmesh.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isSwPublicMeshGroupName } from "@/lib/mesh-standalone-install";

// meshcentral-api starts with `import "server-only"` (throws outside a server
// component) — it MUST load through the require hook below, never via a
// top-level ESM import. meshRunType is required after the hook for that reason.

// --- pure helpers ------------------------------------------------------------

test("meshRunType: powershell -> 2, cmd -> 0 (meshctrl.js:1779 wire)", () => {
  assert.equal(meshRunType("powershell"), 2);
  assert.equal(meshRunType("cmd"), 0);
});

test("isSwPublicMeshGroupName: shared pool + per-user group, NOT lookalikes", () => {
  assert.ok(isSwPublicMeshGroupName("SpaceWorker Public"));
  assert.ok(isSwPublicMeshGroupName("SpaceWorker Public · user-123"));
  // startsWith alone would match this lookalike — the predicate must not.
  assert.ok(!isSwPublicMeshGroupName("SpaceWorker Publicity"));
  assert.ok(!isSwPublicMeshGroupName("TacticalRMM"));
  assert.ok(!isSwPublicMeshGroupName(""));
});

// --- route behaviour (real handler, faked transport) -------------------------

type Loader = {
  _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
};

const ROUTE = "app/api/internal/sw/devices/[agentId]/runmesh/route.ts";

let authOk = true;
let guardThrows: Error | null = null;
let runResult = "OK";
let runCalls: Array<{ nodeId: string; cmds: string; shell: string; runAsUser?: boolean }> = [];

function installRequireHook(): void {
  const loader = Module as unknown as Loader;
  const original = loader._load;
  loader._load = function patched(request, parent, isMain) {
    if (request === "server-only") return {};
    if (request === "@/lib/env") return { env: {} };
    const from = (parent?.filename ?? "").replace(/\\/g, "/");
    if (from.endsWith(`/${ROUTE}`)) {
      if (request === "next/server") {
        return {
          NextResponse: {
            json: (body: unknown, init?: { status?: number }) => ({
              status: init?.status ?? 200,
              body,
              json: async () => body,
            }),
          },
        };
      }
      if (request === "@/lib/sw-internal-auth") {
        return { verifySwSecret: () => authOk };
      }
      if (request === "@/lib/meshcentral-api") {
        return {
          assertMeshNodeInSwPublicGroup: async () => {
            if (guardThrows) throw guardThrows;
          },
          runMeshCommand: async (opts: { nodeId: string; cmds: string; shell: string; runAsUser?: boolean }) => {
            runCalls.push(opts);
            return { result: runResult };
          },
        };
      }
    }
    return original(request, parent, isMain);
  } as Loader["_load"];
}

installRequireHook();

/* eslint-disable @typescript-eslint/no-require-imports */
const { meshRunType } = require("../lib/meshcentral-api.ts") as {
  meshRunType: (shell: "powershell" | "cmd") => number;
};
/* eslint-enable @typescript-eslint/no-require-imports */

type PostFn = (
  req: Request,
  ctx: { params: Promise<{ agentId: string }> },
) => Promise<{ status: number; body: Record<string, unknown> }>;

function loadRoute(): PostFn {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const resolved = require.resolve("../app/api/internal/sw/devices/[agentId]/runmesh/route.ts");
  delete require.cache[resolved];
  const mod = require(resolved) as { POST: PostFn };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return mod.POST;
}

const NODE_ID = "node//b34chZXhhbmdl";
const body = (payload: unknown) =>
  new Request("http://test/runmesh", {
    method: "POST",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify(payload),
  });
const ctx = (agentId: string) => ({ params: Promise.resolve({ agentId }) });


test("runmesh: 401 without the sw bearer", async () => {
  authOk = false;
  const res = await loadRoute()(body({ command: "Get-Date" }), ctx(NODE_ID));
  authOk = true;
  assert.equal(res.status, 401);
});

test("runmesh: 404 for a non-node// id (TRMM ids never dispatch through MeshCentral)", async () => {
  const res = await loadRoute()(body({ command: "Get-Date" }), ctx("trmm-agent-guid-123"));
  assert.equal(res.status, 404);
  assert.equal(runCalls.length, 0);
});

test("runmesh: 400 on empty command", async () => {
  const res = await loadRoute()(body({ command: "   " }), ctx(NODE_ID));
  assert.equal(res.status, 400);
  assert.equal(runCalls.length, 0);
});

test("runmesh: guard failure -> same 404 as unknown device (existence never leaks)", async () => {
  guardThrows = new Error("mesh_node_not_sw_public");
  const res = await loadRoute()(body({ command: "Get-Date" }), ctx(NODE_ID));
  guardThrows = null;
  assert.equal(res.status, 404);
  assert.equal(runCalls.length, 0);
});

test("runmesh: 'OK' dispatch -> {ok:true, output:null} (output never invented)", async () => {
  runResult = "OK";
  runCalls = [];
  const res = await loadRoute()(
    body({ command: "Get-Date", shell: "powershell", runAsUser: false }),
    ctx(NODE_ID),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, output: null });
  assert.deepEqual(runCalls, [
    { nodeId: NODE_ID, cmds: "Get-Date", shell: "powershell", runAsUser: false },
  ]);
});

test("runmesh: 'Agent not connected' -> 503 + the EXACT never-burn offline message", async () => {
  // The literal below is what SpaceWorker's isVantraOfflineError
  // (/vantra_503|currently offline/i) must keep matching through normalizeVantraError.
  runResult = "Agent not connected";
  const res = await loadRoute()(body({ command: "Get-Date" }), ctx(NODE_ID));
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "This device is currently offline." });
});

test("runmesh: other results (access denied…) -> 502 mesh_run_failed, never success", async () => {
  runResult = "Access denied";
  const res = await loadRoute()(body({ command: "Get-Date" }), ctx(NODE_ID));
  assert.equal(res.status, 502);
  assert.match(String(res.body.error), /^mesh_run_failed: Access denied/);
});

// --- source pins (the parts a faked transport cannot see) --------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const runmeshSrc = codeOnly(read(ROUTE));
const apiSrc = codeOnly(read("lib/meshcentral-api.ts"));

test("runMeshCommand payload: exact meshctrl.js:1779 wire with reply:false", () => {
  assert.ok(apiSrc.includes('action: "runcommands"'));
  assert.ok(apiSrc.includes("nodeids: [opts.nodeId]"));
  assert.ok(apiSrc.includes("type: meshRunType(opts.shell)"));
  assert.ok(apiSrc.includes("responseid,")); // echoed back — see meshuser.js:3177
  assert.ok(apiSrc.includes("opts.runAsUser ? 1 : 0"));
  assert.ok(apiSrc.includes("reply: false")); // sync ack; output deliberately not captured
});

test("runmesh route: auth first, node// validation before the body, guard before dispatch", () => {
  const auth = runmeshSrc.indexOf("verifySwSecret(request)");
  const nodeCheck = runmeshSrc.indexOf('agentId.startsWith("node//")');
  const bodyParse = runmeshSrc.indexOf("await request.json()");
  const guard = runmeshSrc.indexOf("assertMeshNodeInSwPublicGroup(agentId)");
  const dispatch = runmeshSrc.indexOf("runMeshCommand({");
  assert.ok(auth >= 0 && nodeCheck >= 0 && bodyParse >= 0 && guard >= 0 && dispatch >= 0);
  assert.ok(auth < nodeCheck && nodeCheck < bodyParse && bodyParse < guard && guard < dispatch);
});
