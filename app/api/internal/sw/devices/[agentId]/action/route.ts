import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  getAgentDetail,
  isAgentUnreachableError,
  rebootAgent,
  runScriptOnAgent,
  sendRawCmd,
  shutdownAgent,
  wakeAgent,
} from "@/lib/trmm";
import { isSwOrgName, SW_ORG_PREFIX } from "@/lib/spaceworker-service";
import { verifySwSecret } from "@/lib/sw-internal-auth";

export const dynamic = "force-dynamic";

// Task 93 — SpaceWorker plugin: gated device actions on a `sw-`-org agent.
// POST /api/internal/sw/devices/[agentId]/action
//   body: { action: "wake" | "reboot" | "shutdown" | "run-script" | "cmd",
//           scriptId?, args?, timeout?, command? }
// TENANT CHECK: the agent must belong to a TRMM client whose client id maps
// to an org named `sw-*` — a customer's own Vantra device is unreachable
// through this route even with a stolen token.

const ALLOWED = new Set(["wake", "reboot", "shutdown", "run-script", "cmd"]);

async function assertAgentInSwOrg(agentId: string): Promise<string | null> {
  const detail = await getAgentDetail(agentId);
  // AgentDetail carries client_id (TRMM detail payload); fall back to the
  // client row matched by the agent's client name if the field is absent.
  const clientId =
    typeof detail.client_id === "number"
      ? detail.client_id
      : typeof detail.client === "number"
        ? detail.client
        : null;
  if (clientId === null) return null;
  const org = await db.organization.findFirst({
    where: { trmmClientId: clientId, name: { startsWith: SW_ORG_PREFIX } },
    select: { name: true },
  });
  return org && isSwOrgName(org.name) ? org.name : null;
}

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
          shell: "powershell",
          timeout: typeof body.timeout === "number" ? body.timeout : 90,
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