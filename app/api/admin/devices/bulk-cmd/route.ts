import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { isAgentUnreachableError, listAgents, sendRawCmd } from "@/lib/trmm";

export const dynamic = "force-dynamic";

// POST /api/admin/devices/bulk-cmd — Task 44 req #11 (2026-09-19). Runs a
// cmd/PowerShell command across a chosen set of ONE customer's devices,
// single or bulk, admin-only. Deliberately scoped, per the confirmed answer
// in TASK_44_VANTRA_DESKTOP_EXE.md: "No cross-customer bulk — never touches
// more than one customer's fleet in a single action." Enforced here, not
// just in the UI: every agentId in the request is re-verified server-side
// against a fresh listAgents(org.trmmClientId) call before anything runs —
// a tampered request naming another customer's agent id is silently dropped
// rather than executed.
//
// Runs silently: sendRawCmd (same primitive the existing customer-facing
// single-device route already uses) talks directly to the TRMM agent
// service running in the background on the device — runAsUser defaults to
// false, so nothing pops up on the end user's screen, and nothing here
// notifies any client (web dashboard or the separate Vantra Desktop EXE
// wrapper) that this ran. Those are two different things: this bulk action
// only ever touches TRMM-monitored "Devices", never the Vantra EXE wrapper
// app or its own license/session state.
const bodySchema = z.object({
  orgId: z.string().min(1),
  agentIds: z.array(z.string().min(1)).min(1).max(200),
  cmd: z.string().min(1).max(8000),
  shell: z.enum(["cmd", "powershell", "custom"]).default("cmd"),
  customShell: z.string().optional().nullable(),
  timeout: z.number().int().min(1).max(90).default(30),
  runAsUser: z.boolean().default(false),
});

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const org = await db.organization.findUnique({ where: { id: parsed.orgId } });
  if (!org || !org.trmmClientId) {
    return NextResponse.json({ error: "That organization has no devices." }, { status: 404 });
  }

  // The re-verification: only agent ids that genuinely belong to THIS org's
  // TRMM client survive. Anything else in the request is dropped, not
  // executed and not reported as an error — it's treated as if it was never
  // asked for, since a legitimate admin session would never send one.
  let ownedAgentIds: Set<string>;
  try {
    const agents = await listAgents(org.trmmClientId);
    ownedAgentIds = new Set(agents.map((a) => a.agent_id));
  } catch (err) {
    console.error("Failed to verify device ownership for bulk-cmd:", err);
    return NextResponse.json({ error: "Couldn't reach the device fleet service." }, { status: 502 });
  }
  const targetIds = parsed.agentIds.filter((id) => ownedAgentIds.has(id));
  if (targetIds.length === 0) {
    return NextResponse.json(
      { error: "None of the selected devices belong to this organization." },
      { status: 400 },
    );
  }

  // Sequential, not Promise.all — a bulk command against many devices at once
  // is exactly the kind of action that should never fan out uncontrolled
  // against a real customer's fleet, and per-device results stay in a
  // predictable order for the admin reading them.
  const results: Array<{ agentId: string; ok: boolean; output?: string; error?: string }> = [];
  for (const agentId of targetIds) {
    try {
      const output = await sendRawCmd({
        agentId,
        cmd: parsed.cmd,
        shell: parsed.shell,
        customShell: parsed.customShell ?? null,
        timeout: parsed.timeout,
        runAsUser: parsed.runAsUser,
      });
      results.push({ agentId, ok: true, output });
    } catch (err) {
      results.push({
        agentId,
        ok: false,
        error: isAgentUnreachableError(err) ? "Device is offline." : "Command failed or timed out.",
      });
    }
  }

  return NextResponse.json({ orgId: org.id, orgName: org.name, results });
}
