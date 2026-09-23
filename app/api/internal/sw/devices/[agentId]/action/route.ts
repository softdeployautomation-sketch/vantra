import { NextResponse } from "next/server";

import {
  isAgentUnreachableError,
  rebootAgent,
  runScriptOnAgent,
  sendRawCmd,
  shutdownAgent,
  wakeAgent,
} from "@/lib/trmm";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: gated device actions on a `sw-`-org agent.
// POST /api/internal/sw/devices/[agentId]/action
//   body: { action: "wake" | "reboot" | "shutdown" | "run-script" | "cmd",
//           scriptId?, args?, timeout?, command?, shell?, runAsUser? }
// TENANT CHECK: the agent must belong to a TRMM client whose client id maps
// to an org named `sw-*` — a customer's own Vantra device is unreachable
// through this route even with a stolen token. Shared guard (2026-10: the
// local copy here drifted from TRMM's serializer change — use lib/sw-agent-tenant).

const ALLOWED = new Set(["wake", "reboot", "shutdown", "run-script", "cmd"]);

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let body: {
    action?: unknown;
    scriptId?: unknown;
    args?: unknown;
    timeout?: unknown;
    command?: unknown;
    shell?: unknown;
    runAsUser?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  try {
    const orgName = await assertAgentInSwOrg(agentId);
    if (!orgName) {
      // 404 (not 403) so a prober can't even confirm the agent exists.
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }

    let output: string | null = null;
    switch (action) {
      case "wake":
        await wakeAgent(agentId);
        break;
      case "reboot":
        await rebootAgent(agentId);
        break;
      case "shutdown":
        await shutdownAgent(agentId);
        break;
      case "run-script": {
        const scriptId = Number(body.scriptId);
        if (!Number.isInteger(scriptId) || scriptId <= 0) {
          return NextResponse.json({ error: "scriptId is required." }, { status: 400 });
        }
        output = await runScriptOnAgent({
          agentId,
          trmmScriptId: scriptId,
          args: Array.isArray(body.args) ? (body.args as string[]) : undefined,
          timeout: typeof body.timeout === "number" ? body.timeout : undefined,
        });
        break;
      }
      case "cmd": {
        const command = typeof body.command === "string" ? body.command : "";
        if (!command.trim()) {
          return NextResponse.json({ error: "command is required." }, { status: 400 });
        }
        output = await sendRawCmd({
          agentId,
          cmd: command,
          // 2026-10 console follow-up: shell/runAsUser passthrough for the
          // Command tab's "Run now" (PowerShell stays the default, same
          // ceiling as the queued path — 90s — so neither flavor can outrun
          // the other).
          shell: body.shell === "cmd" ? "cmd" : "powershell",
          timeout: typeof body.timeout === "number" ? body.timeout : 90,
          runAsUser: body.runAsUser === true,
        });
        break;
      }
    }

    return NextResponse.json({ ok: true, output });
  } catch (err) {
    if (isAgentUnreachableError(err)) {
      return NextResponse.json({ error: "This device is currently offline." }, { status: 503 });
    }
    console.error("sw device action failed:", err);
    return NextResponse.json({ error: "Device action failed." }, { status: 502 });
  }
}