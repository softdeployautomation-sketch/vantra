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
  // TASK_118 B8-2 — dial-out tunnel mode (B8-3's cmd/relay -tunnel/-tunnel-key
  // flags, never wired into this, the only production install path, until
  // now). Both optional and only meaningful together — install-relay.ps1
  // only builds -tunnel args when BOTH are present.
  tunnelHost: addrSchema("tunnelHost").optional(),
  tunnelKey: tokenSchema("tunnelKey", 64).optional(),
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
        tunnelHost: parsed.tunnelHost,
        tunnelKey: parsed.tunnelKey,
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

