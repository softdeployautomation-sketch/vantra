import { NextResponse } from "next/server";

import { clearAdminSessionCookie, requireAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  // Every admin API route (except login) guards itself — a sibling route tree
  // the page layout doesn't cover.
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  await clearAdminSessionCookie();
  return NextResponse.json({ ok: true });
}