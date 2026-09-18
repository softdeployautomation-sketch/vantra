import { NextResponse } from "next/server";

import { isLocalExeRuntime } from "@/lib/exe-runtime";
import { listLiveDevices } from "@/lib/local-db/repo";

export const dynamic = "force-dynamic";

// Task 44.4 — local devices LIST for the desktop EXE. Served ONLY by the bundled
// local runtime (a thin device-management surface that works offline, backed by
// the local SQLite DB). Mirrors the response shape of the hosted /api/devices so
// the client renders the same DeviceCard list, but reads the local mirror instead
// of TRMM/Postgres. Gated behind isLocalExeRuntime() like every EXE-only path —
// fail-closed: 404 on the hosted web server, which never has these tables.
export async function GET() {
  if (!isLocalExeRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const devices = await listLiveDevices();
    return NextResponse.json({ devices, local: true });
  } catch (err) {
    console.error("GET /api/local/devices failed:", err);
    return NextResponse.json(
      { error: "Something went wrong loading your devices." },
      { status: 500 },
    );
  }
}