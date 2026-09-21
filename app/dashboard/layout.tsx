import { redirect } from "next/navigation";

import { ExeAutoBind } from "@/components/exe-auto-bind";
import { Shell } from "@/components/shell";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

// Desktop mode (2026-09-18/19 spec, revised 2026-09-19 after live testing) —
// deliberately NOT gated here. A shared layout has no reliable, built-in way
// to know which specific route it's rendering for (the custom-header
// approach was tried and confirmed broken for client-side navigation —
// Settings/Support ended up incorrectly gated too, confirmed live in
// incognito). Each page that needs gating (dashboard root, device detail,
// add device) now computes lib/desktop-mode.ts's getDesktopModeGate() and
// renders DesktopLockScreen itself; Settings and Support simply never call
// it, so there is no code path left that could ever gate them by mistake.
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
    select: { id: true, name: true, agentDomainTier: true },
  });

  return (
    <>
      <ExeAutoBind />
      <Shell
        activeOrg={{ id: org.id, name: org.name, agentDomainTier: org.agentDomainTier }}
        organizations={organizations}
        walletBalanceCents={user.walletBalanceCents}
      >
        {children}
      </Shell>
    </>
  );
}