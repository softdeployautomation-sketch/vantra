import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardClient } from "@/components/dashboard-client";
import { DesktopLockScreen } from "@/components/desktop-lock-screen";
import { getDesktopModeGate } from "@/lib/desktop-mode";
import { getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

// Desktop mode (2026-09-19) — gated directly in this page rather than the
// shared layout (see app/dashboard/layout.tsx's comment for why). Settings
// and Support never call getDesktopModeGate() at all, so they can never be
// affected by this regardless of how this page's own check behaves.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const desktopGate = await getDesktopModeGate(user.id);
  if (desktopGate.gated) {
    return <DesktopLockScreen boundMachineLabel={desktopGate.boundMachineLabel} />;
  }

  return <DashboardClient />;
}
