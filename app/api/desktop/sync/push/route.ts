import { NextRequest, NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { applyPushRow, MirrorAuthError, resolveInstall } from "@/lib/desktop-sync/mirror";
import type { PushRow } from "@/lib/desktop-sync/mirror";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Task 44.4, increment 2 — the EXE pushes its durable outbox here (hosted). Each
// row is merged into the org's DesktopDeviceMirror with the shared LWW rule; only
// accepted rows are acked (so the EXE clears its outbox + dirty flag). Auth is the
// per-install identity (install_id + machine_id + install_secret headers, D6 +
// Task 46), never a web session — a correct machine-id alone is not sufficient.
export async function POST(request: NextRequest) {
  try {
    // Defense in depth (Task 46): bound the volume from any single IP before any
    // auth/DB work, regardless of whether the caller knows a valid secret.
    if (!(await allowAndRecord(await getClientIp(), "desktop-sync-push"))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const install = await resolveInstall(
      request.headers.get("x-install-id"),
      request.headers.get("x-machine-id"),
      request.headers.get("x-install-secret"),
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