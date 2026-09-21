import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Task 69, scope 5 — admin reads of the locked-out triage inbox. Self-guarded
// via requireAdminSession() like every other admin API route. Read-only list
// here; resolve action lives beside it.
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const contacts = await db.supportContact.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ contacts });
}
