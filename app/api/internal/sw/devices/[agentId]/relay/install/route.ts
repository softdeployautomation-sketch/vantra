import { NextResponse } from "next/server";
import { z } from "zod";

import { sendRawCmd } from "@/lib/trmm";
import { cloneAuth, cloneErr, type CloneRouteContext } from "@/lib/clone-route";
import { buildRelayInstall } from "@/lib/clone-engine-cmds";
import { exitSummary, parseRcMarkers } from "@/lib/clone-engine-parse";
import { addrSchema, tokenSchema, windowsPathSchema } from "@/lib/clone-engine";

export const dynamic = "force-dynamic";

// TASK_108 (bit B2) — source-side relay install. Wraps
// `engine/scripts/install-relay.ps1` (quarantine-first: Defender path +
// process exclusions VERIFIED while the folder is still empty, then the
// binary lands, then the SpaceworkerRelay scheduled task). The raw relay
// token arrives here as a `-Token` PARAMETER — it lands in the on-device
// task registration only, never in our DB or logs (only the SHA-256 is
// stored, SpaceWorker side, per the RelayHealth contract).
const installSchema = z.object({
  newRelayExe: windowsPathSchema("newRelayExe"),
  installDir: windowsPathSchema("installDir").optional(),
  addr: addrSchema("addr").optional(),
  token: tokenSchema("token", 128).optional(),
  installScript: windowsPathSchema("installScript").optional(),
  timeout: z.number().int().min(30).max(600).default(300),
});

export async function POST(request: Request, ctx: CloneRouteContext) {
  const authed = await cloneAuth(request, ctx);
  if (authed instanceof NextResponse) return authed;

  let parsed;
  try {
    parsed = installSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const output = await sendRawCmd({
      agentId: authed.agentId,
      cmd: buildRelayInstall({
        newRelayExe: parsed.newRelayExe,
        installDir: parsed.installDir,
        addr: parsed.addr,
        token: parsed.token,
        installScript: parsed.installScript,
      }),
      shell: "powershell",
      timeout: parsed.timeout,
      runAsUser: false,
    });
    const rc = parseRcMarkers(output)["relay-install"];
    const result = exitSummary(rc);
    return NextResponse.json({ ok: result === "ok", exitCode: rc ?? null });
  } catch (err) {
    return cloneErr(err, "relay install");
  }
}

