import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DesktopLockScreen } from "@/components/desktop-lock-screen";
import { ExeAutoBind } from "@/components/exe-auto-bind";
import { Shell } from "@/components/shell";
import { db } from "@/lib/db";
import { getDesktopModeGate } from "@/lib/desktop-mode";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

// Desktop mode (2026-09-18/19 spec, revised 2026-09-19 after live testing) —
// once bound, Settings/Support/Wallet stay fully usable from any session (so
// a customer can always get help or move their license to a new machine);
// everything else shows an inline lock screen INSTEAD of its real content —
// no redirect, no hunting for a button, and never any actual device data.
const ALLOWED_WHEN_GATED = ["/dashboard/settings", "/dashboard/support"];

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

  // Desktop mode — once this account's Vantra Desktop license is bound
  // somewhere, every OTHER session reaching a route outside the allowlist
  // above sees a lock screen INSTEAD of that route's real content (nav,
  // wallet balance, everything else in Shell stays exactly the same). The
  // session that genuinely IS the bound device is never gated.
  const desktopGate = await getDesktopModeGate(user.id);
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isAllowedRoute = ALLOWED_WHEN_GATED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const showLockScreen = desktopGate.gated && !isAllowedRoute;

  return (
    <>
      <ExeAutoBind />
      <Shell
        activeOrg={{ id: org.id, name: org.name }}
        organizations={organizations}
        walletBalanceCents={user.walletBalanceCents}
      >
        {showLockScreen ? (
          <DesktopLockScreen boundMachineLabel={desktopGate.boundMachineLabel} />
        ) : (
          children
        )}
      </Shell>
    </>
  );
}