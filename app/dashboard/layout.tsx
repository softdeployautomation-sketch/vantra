import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { db } from "@/lib/db";
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

  return (
    <Shell
      activeOrg={{ id: org.id, name: org.name }}
      organizations={organizations}
      walletBalanceCents={user.walletBalanceCents}
    >
      {children}
    </Shell>
  );
}