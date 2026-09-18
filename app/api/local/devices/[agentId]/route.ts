import { NextResponse } from "next/server";

import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { deleteDeviceLocal, setLocalLabel } from "@/lib/local-db/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ agentId: string }> };

// Task 44.4 — local device mutation for the desktop EXE: rename (label) and
// soft-delete (tombstone). Both write the local SQLite DB + a durable outbox row
// that the sync engine (increment 2) pushes to the cloud mirror on reconnect.
// Fail-closed via isLocalExeRuntime() — inert on the hosted web server.
export async function PATCH(req: Request, ctx: Ctx) {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { agentId } = await ctx.params;
  if (!agentId) {
    return NextResponse.json({ error: "Missing device id." }, { status: 400 });
  }
  let body: { label?: unknown } = {};
  try {
    body = (await req.json()) as { label?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Label is required." }, { status: 400 });
  }
  try {
    await setLocalLabel(agentId, label);
    return NextResponse.json({ ok: true, label });
  } catch (err) {
    console.error("PATCH /api/local/devices/[agentId] failed:", err);
    return NextResponse.json({ error: "Could not update the device." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { agentId } = await ctx.params;
  if (!agentId) {
    return NextResponse.json({ error: "Missing device id." }, { status: 400 });
  }
  try {
    await deleteDeviceLocal(agentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/local/devices/[agentId] failed:", err);
    return NextResponse.json({ error: "Could not remove the device." }, { status: 500 });
  }
}