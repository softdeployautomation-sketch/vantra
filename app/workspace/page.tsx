import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { WorkspaceHandoff } from "@/components/workspace-handoff";
import { getExeDeviceCookie, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXE_PRODUCT, keyExpiryIsAfter } from "@/lib/exe-license";

export const metadata: Metadata = { title: "Workspace" };

// Deliberately outside app/dashboard/ (same reasoning as /console/[agentId])
// so it does NOT inherit the full Shell layout -- this page IS the app frame
// (a tab bar), not content inside one. No AUTH check here — that stays
// exactly as before, enforced by the Dashboard tab's own iframe. Session-
// user.ts (via getCurrentUser()) never runs here.
//
// Cookie-priming redirect (2026-09-19, closing a real race — see the fuller
// comment on /api/exe-license/enter, which is where the actual cookie write
// happens; Next.js only allows setting cookies from a Route Handler or
// Server Action, never during a page's own render, so it can't happen
// directly here). If the caller is ALREADY logged in, deviceId names a
// device the DB already shows as bound to them, AND the exe-device cookie
// doesn't already reflect that (the common case on every relaunch, since
// the local EXE never writes "activated" back to its own trial file), this
// bounces once through that route to set the cookie before rendering
// anything, then lands right back here with the exact same query string —
// closing the window where the nested Dashboard iframe's own gate check
// could run before the cookie existed. Already-primed, not-yet-logged-in,
// or not-yet-bound visits render straight through with no extra hop.
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const deviceId = params.deviceId?.trim();

  if (deviceId) {
    const existing = await getExeDeviceCookie();
    const alreadyPrimed = existing?.trim().toLowerCase() === deviceId.toLowerCase();
    if (!alreadyPrimed) {
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
          const qs = new URLSearchParams(
            Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
          );
          redirect(`/api/exe-license/enter?${qs.toString()}`);
        }
      }
    }
  }

  return (
    <>
      <Suspense fallback={null}>
        <WorkspaceHandoff />
      </Suspense>
      <WorkspaceShell />
    </>
  );
}
