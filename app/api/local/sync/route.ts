import { NextResponse } from "next/server";

import { isLocalExeRuntime } from "@/lib/exe-runtime";

export const dynamic = "force-dynamic";

// Task 44.4 — local↔cloud sync entry point for the desktop EXE (increment 2).
// The LocalDevices "Sync" button POSTs here. The push/pull engine hits
// /api/desktop/sync/* on the hosted mirror; today this is a stub so the client
// button works offline and the route is wired, and so CI/local dev can run the
// UI before the sync engine lands. Returns the kernel of the sync status the UI
// will later surface (pending outbox count is a cheap offline signal).
export async function POST() {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const { pendingOutbox } = await import("@/lib/local-db/repo");
    const pending = await pendingOutbox();
    return NextResponse.json({
      ok: true,
      synced: false,
      note: "sync engine wiring in place; cloud push/pull lands in increment 2",
      pendingOutbox: pending.length,
    });
  } catch (err) {
    console.error("POST /api/local/sync failed:", err);
    return NextResponse.json({ ok: false, error: "Sync unavailable." }, { status: 500 });
  }
}