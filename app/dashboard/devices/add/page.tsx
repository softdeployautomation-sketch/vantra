import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AddDevicePageClient } from "@/components/add-device-page-client";
import { DesktopLockScreen } from "@/components/desktop-lock-screen";
import { getDesktopModeGate } from "@/lib/desktop-mode";
import { getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Add Device" };

export const dynamic = "force-dynamic";

// Desktop mode (2026-09-19) — see app/dashboard/page.tsx's comment; gated
// directly in each page that manages devices, not the shared layout.
export default async function AddDevicePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const desktopGate = await getDesktopModeGate(user.id);
  if (desktopGate.gated) {
    return <DesktopLockScreen boundMachineLabel={desktopGate.boundMachineLabel} />;
  }

  return <AddDevicePageClient />;
}
