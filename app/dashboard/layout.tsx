import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { getSession } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  if (!session.emailVerified) {
    redirect(`/verify?email=${encodeURIComponent(session.email)}`);
  }

  return <Shell>{children}</Shell>;
}