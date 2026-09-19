import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { WorkspaceHandoff } from "@/components/workspace-handoff";
import { getSession, setExeDeviceCookie } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXE_PRODUCT, keyExpiryIsAfter } from "@/lib/exe-license";

export const metadata: Metadata = { title: "Workspace" };

// Deliberately outside app/dashboard/ (same reasoning as /console/[agentId])
// so it does NOT inherit the full Shell layout -- this page IS the app frame
// (a tab bar), not content inside one. No AUTH check here — that stays
// exactly as before, enforced by the Dashboard tab's own iframe. Session-
// user.ts (via getCurrentUser()) never runs here.
//
// What this page DOES do now (2026-09-19, closing a real race): if the
// caller is ALREADY logged in AND deviceId names a device the DB already
// shows as bound to them, set the exe-device cookie right here, synchronously,
// before the nested Dashboard iframe ever makes its own request. Without
// this, on every relaunch the cookie only ever got (re-)established by a
// CLIENT-SIDE script running INSIDE that iframe, after the iframe's own
// server-side desktop-mode gate check had already run and — seeing no
// cookie yet — incorrectly redirected the legitimate bound device to
// Settings. It self-corrected on the very next click (once the client
// script had caught up), but the first hit after every relaunch was wrong.
// A brand-new, not-yet-logged-in, or not-yet-bound device is untouched —
// this only ever sets the cookie for a session that's already proven to be
// the genuinely bound one.
async function primeExeDeviceCookie(deviceId: string | undefined): Promise<void> {
  if (!deviceId) return;
  const session = await getSession();
  if (!session) return;
  const rows = await db.exeLicense.findMany({ where: { userId: session.sub, product: EXE_PRODUCT } });
  const now = new Date();
  const isBoundHere = rows.some(
    (l) =>
      l.boundMachineId?.trim().toLowerCase() === deviceId.trim().toLowerCase() &&
      keyExpiryIsAfter(l.licenseKey, now),
  );
  if (isBoundHere) {
    await setExeDeviceCookie(deviceId);
  }
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ deviceId?: string }>;
}) {
  const { deviceId } = await searchParams;
  await primeExeDeviceCookie(deviceId);

  return (
    <>
      <Suspense fallback={null}>
        <WorkspaceHandoff />
      </Suspense>
      <WorkspaceShell />
    </>
  );
}
