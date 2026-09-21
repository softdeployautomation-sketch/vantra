import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Task 69, scope 5 — PATCH /api/admin/support-contacts/[id]: mark one
// locked-out contact resolved (or reopen it). Self-guarded via
// requireAdminSession(). Staff reply by emailing the address the person gave
// (a triage inbox, not the Ticket thread) — this just tracks the queue.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const resolved = body?.resolved !== false;
  const existing = await db.supportContact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const updated = await db.supportContact.update({
    where: { id },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  return NextResponse.json({ contact: updated });
}
