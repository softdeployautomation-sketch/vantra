import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { verifySwSecret } from "@/lib/sw-internal-auth";
import { assertAgentInSwOrg } from "@/lib/sw-agent-tenant";
import { ensureServiceUser } from "@/lib/spaceworker-service";

export const dynamic = "force-dynamic";

// Task 95 — SpaceWorker plugin: queued commands for an OFFLINE `sw-` org
// agent (Vantra Task 18 mechanic — fired by the online-transition sweep in
// app/api/internal/telegram-device-check when the device checks in). Vantra
// owns the ONE queue + sweep; SpaceWorker mirrors rows for display/cancel in
// its own db. NO second sweep here — that would double-fire commands.

const createSchema = z.object({
  // 64k (was 8k): SpaceWorker's scheduled PIN collect queues the full prompt
  // launcher here — its base64 WinForms script is ~15KB. The column is TEXT
  // and the sweep sends it through the same sendRawCmd path as live cmds.
  cmd: z.string().min(1).max(64_000),
  shell: z.enum(["cmd", "powershell"]).default("powershell"),
  // Same ceiling as the live cmd path so a queued command can never outrun
  // what a real-time run would allow when it finally fires.
  timeout: z.number().int().min(1).max(90).default(30),
  runAsUser: z.boolean().default(false),
  // SpaceWorker's own row id — echoed back so the caller can link its mirror.
  swRef: z.string().min(1).max(64).optional(),
  // Console schedule flavor: "next_checkin" (default — fire on the first
  // online poll) or "after_wake" (fire wakeDelayMinutes after the device
  // COMES ON; the sweep anchors wakeAt on that transition).
  scheduleKind: z.enum(["next_checkin", "after_wake"]).default("next_checkin"),
  wakeDelayMinutes: z.number().int().min(0).max(7 * 24 * 60).default(0),
});

async function assertAccess(agentId: string): Promise<boolean> {
  return (await assertAgentInSwOrg(agentId)) !== null;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  try {
    if (!(await assertAccess(agentId))) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    const commands = await db.queuedAgentCommand.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, shell: true, cmd: true, timeoutSeconds: true,
        runAsUser: true, status: true, createdAt: true, sentAt: true, error: true,
      },
    });
    return NextResponse.json({ ok: true, commands });
  } catch (err) {
    console.error("sw queued-commands list failed:", err);
    return NextResponse.json({ error: "Couldn't list queued commands." }, { status: 502 });
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let parsed;
  try {
    parsed = createSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    if (!(await assertAccess(agentId))) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    // QueuedAgentCommand.userId is a REAL FK to Vantra's User table (the
    // online-transition sweep reads rows by agentId, but the FK must hold).
    // All sw-org queues belong to the dedicated service user.
    const svc = await ensureServiceUser();
    const created = await db.queuedAgentCommand.create({
      data: {
        agentId,
        userId: svc.id,
        shell: parsed.shell,
        cmd: parsed.cmd,
        timeoutSeconds: parsed.timeout,
        runAsUser: parsed.runAsUser,
        scheduleKind: parsed.scheduleKind,
        wakeDelayMinutes: parsed.wakeDelayMinutes,
      },
      select: { id: true, status: true, createdAt: true },
    });
    return NextResponse.json({ ok: true, queueId: created.id, swRef: parsed.swRef ?? null });
  } catch (err) {
    console.error("sw queued-commands create failed:", err);
    return NextResponse.json({ error: "Couldn't queue the command." }, { status: 502 });
  }
}

const deleteSchema = z.object({
  queueId: z.string().min(1).max(64),
});

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  if (!verifySwSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await ctx.params;

  let parsed;
  try {
    parsed = deleteSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    if (!(await assertAccess(agentId))) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    // Cancel-guard: only a still-queued row can be cancelled (the sweep may
    // have fired it between the user's click and this call — that's fine, the
    // user sees the row flip to sent on their next poll).
    const updated = await db.queuedAgentCommand.updateMany({
      where: { id: parsed.queueId, agentId, status: "queued" },
      data: { status: "cancelled" },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "not_queued" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("sw queued-commands cancel failed:", err);
    return NextResponse.json({ error: "Couldn't cancel the command." }, { status: 502 });
  }
}
