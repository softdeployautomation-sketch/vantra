import { NextRequest, NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { MirrorAuthError, pullDelta, resolveInstall } from "@/lib/desktop-sync/mirror";

export const dynamic = "force-dynamic";

// Task 44.4, increment 2 — the EXE pulls its org's desktop_device delta from the
// hosted mirror, since the install's stored cursor. Returns the SAME ServerDevice
// shape the local applyServerDevice expects (incl. tombstones via deleted_at) plus
// the next cursor, which the EXE persists. Auth is per-install identity (D6).
// The cursor body field is optional — the server always uses the install's stored
// cursor; the EXE sends it back defensively so the two sides agree on a baseline.
export async function POST(request: NextRequest) {
  try {
    const install = await resolveInstall(
      request.headers.get("x-install-id"),
      request.headers.get("x-machine-id"),
    );

    const { rows, nextCursor } = await pullDelta(install);
    return NextResponse.json({ rows, nextCursor });
  } catch (e) {
    if (e instanceof MirrorAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    logApiError({
      route: "api/desktop/sync/pull",
      method: "POST",
      statusCode: 500,
      error: e,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}