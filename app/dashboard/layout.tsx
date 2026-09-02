import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { getCurrentUser } from "@/lib/session-user";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Real gate uses a fresh DB read (authoritative) rather than the JWT.
  if (!user) redirect("/login");
  if (!user.emailVerified) redirect(`/verify?email=${encodeURIComponent(user.email)}`);
  // Org onboarding must be completed before the dashboard is reachable.
  if (!user.orgName) redirect("/onboarding");

  return (
    <Shell orgName={user.orgName}>
      {children}
    </Shell>
  );
}