import { NextResponse } from "next/server";

import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { syncLocal } from "@/lib/local-db/sync";

export const dynamic = "force-dynamic";

// Task 44.4, increment 2 — the local<->cloud sync entry point for the desktop EXE.
// The LocalDevices "Sync" button POSTs here. The push/pull ENGINE (lib/local-db/sync.ts)
// flushes the durable outbox to the hosted mirror (/api/desktop/sync/push) and pulls the
// cursor delta (/api/desktop/sync/pull), applying each server row via applyServerDevice
// (LWW + tie-break + tombstones — see design §4/§5). The sync host is EXE_SYNC_HOST, else
// the hosted app home, and per-install auth (install_id+machine_id, design D6) rides on
// the request. Offline (host unreachable), the route returns ok:false + errors while the
// local list still works — that's the whole local-first claim.
export async function POST() {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await syncLocal();
    return NextResponse.json({
      ok: result.errors.length === 0,
      pushed: result.pushed,
      pulled: result.pulled,
      errors: result.errors.slice(0, 5),
      pendingRemaining: result.pendingRemaining,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? e },
      { status: 500 },
    );
  }
}