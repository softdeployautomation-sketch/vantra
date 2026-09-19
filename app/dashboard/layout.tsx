import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ExeAutoBind } from "@/components/exe-auto-bind";
import { Shell } from "@/components/shell";
import { db } from "@/lib/db";
import { getDesktopModeGate } from "@/lib/desktop-mode";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Real gate uses a fresh DB read (authoritative) rather than the JWT.
  if (!user) redirect("/login");
  if (!user.emailVerified) redirect(`/verify?email=${encodeURIComponent(user.email)}`);
  // Org onboarding must be completed before the dashboard is reachable: the org
  // row is auto-created during verification/provisioning, but it has no display
  // name until the customer names it here.
  const org = await getActiveOrganization(user);
  if (!org?.name) redirect("/onboarding");

  const organizations = await db.organization.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  // Desktop mode (2026-09-18/19 spec) — once this account's Vantra Desktop
  // license is bound somewhere, every OTHER way of reaching it (a plain web
  // browser here, or a different device) narrows to Settings only — billing
  // + the license status (and "Switch back to web") live there. The session
  // that genuinely IS the bound device is never redirected.
  const desktopGate = await getDesktopModeGate(user.id);
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (desktopGate.gated && pathname !== "/dashboard/settings") {
    redirect("/dashboard/settings");
  }

  return (
    <>
      <ExeAutoBind />
      <Shell
        activeOrg={{ id: org.id, name: org.name }}
        organizations={organizations}
        walletBalanceCents={user.walletBalanceCents}
      >
        {children}
      </Shell>
    </>
  );
}