import { NextResponse } from "next/server";

import { unbindExeLicense } from "@/lib/exe-license-bind";
import { EXE_PRODUCT } from "@/lib/exe-license";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// POST /api/exe-license/switch-to-web — desktop mode (2026-09-19). Session-
// gated (the caller's own account, same as self-service). Finds this user's
// currently bound Vantra Desktop license and unbinds it, restoring full web
// access on any browser from the next request — the bound device's own
// session dies on its next authenticated request via the existing
// revocation check in lib/session-user.ts. Idempotent: no-op if nothing is
// currently bound.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rows = await db.exeLicense.findMany({ where: { userId: user.id, product: EXE_PRODUCT } });
  const bound = rows.find((l) => l.boundMachineId);
  if (!bound) return NextResponse.json({ ok: true, wasBound: false });

  await unbindExeLicense(bound.id);
  return NextResponse.json({ ok: true, wasBound: true });
}
