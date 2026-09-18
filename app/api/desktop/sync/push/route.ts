import { NextRequest, NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { applyPushRow, MirrorAuthError, resolveInstall } from "@/lib/desktop-sync/mirror";
import type { PushRow } from "@/lib/desktop-sync/mirror";

export const dynamic = "force-dynamic";

// Task 44.4, increment 2 — the EXE pushes its durable outbox here (hosted). Each
// row is merged into the org's DesktopDeviceMirror with the shared LWW rule; only
// accepted rows are acked (so the EXE clears its outbox + dirty flag). Auth is the
// per-install identity (install_id + machine_id headers, D6), never a web session.
export async function POST(request: NextRequest) {
  try {
    const install = await resolveInstall(
      request.headers.get("x-install-id"),
      request.headers.get("x-machine-id"),
    );

    const body = (await request.json().catch(() => ({}))) as { rows?: PushRow[] };
    const rows = Array.isArray(body.rows) ? body.rows : [];

    const acked: string[] = [];
    const nowIso = new Date().toISOString();
    for (const row of rows) {
      if (!row || !row.id || !isObject(row.data)) continue;
      try {
        const ok = await applyPushRow(install, row, nowIso);
        if (ok) acked.push(row.id);
      } catch {
        // a failed row is simply not acked — the EXE retries on the next cycle
      }
    }

    return NextResponse.json({ acked, accepted: acked.length });
  } catch (e) {
    if (e instanceof MirrorAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    logApiError({
      route: "api/desktop/sync/push",
      method: "POST",
      statusCode: 500,
      error: e,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}