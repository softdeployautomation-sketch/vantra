import { NextResponse } from "next/server";

import { getSession, setExeDeviceCookie } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXE_PRODUCT, keyExpiryIsAfter } from "@/lib/exe-license";

export const dynamic = "force-dynamic";

// GET /api/exe-license/enter — the ONLY place the exe-device cookie is set
// from the workspace-handoff path (2026-09-19). app/workspace/page.tsx
// redirects here (with the exact same query string) whenever it can't
// already tell the current session is the bound device — Next.js only
// allows setting cookies from a Route Handler or Server Action, never
// during a page's own render, so the write has to happen here rather than
// in the page itself. Re-verifies (defense in depth: the page already
// checked once, but nothing here trusts that) that the caller is logged in
// and deviceId genuinely names their currently-bound device before writing
// anything, then bounces straight back to /workspace with the same query
// string workspace-handoff.tsx and the rest of the flow still expect.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId")?.trim();

  if (deviceId) {
    const session = await getSession();
    if (session) {
      const rows = await db.exeLicense.findMany({ where: { userId: session.sub, product: EXE_PRODUCT } });
      const now = new Date();
      const isBoundHere = rows.some(
        (l) =>
          l.boundMachineId?.trim().toLowerCase() === deviceId.toLowerCase() &&
          keyExpiryIsAfter(l.licenseKey, now),
      );
      if (isBoundHere) {
        await setExeDeviceCookie(deviceId);
      }
    }
  }

  const dest = new URL("/workspace", url.origin);
  dest.search = url.search;
  return NextResponse.redirect(dest);
}
