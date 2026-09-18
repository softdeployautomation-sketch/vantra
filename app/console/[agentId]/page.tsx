import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RemoteTools } from "@/components/remote-tools";
import { RemoteToolsLocked } from "@/components/remote-tools-locked";
import { canAccessAgent } from "@/lib/authz";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Device console" };

export const dynamic = "force-dynamic";

// Deliberately OUTSIDE app/dashboard/ so it does NOT inherit the full Shell
// layout (sidebar nav, wallet balance, org switcher) — this is the page
// "Open in new tab" pops out to, meant to be a slim full-screen console, not
// the whole app frame. It re-does the same auth/authz checks the dashboard
// layout and the device detail page do (getCurrentUser, email verified, org
// onboarded, canAccessAgent IDOR guard) since none of that runs here for free.
export default async function DeviceConsolePage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (!user.emailVerified) redirect(`/verify?email=${encodeURIComponent(user.email)}`);
  const org = await getActiveOrganization(user);
  if (!org?.name) redirect("/onboarding");

  const allowed = await canAccessAgent(agentId, {
    isStaff: user.isStaff,
    trmmClientId: org?.trmmClientId ?? null,
  });
  if (!allowed) notFound();

  const plan = org?.plan ?? "free";

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elevated px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">Vantra</span>
          <span className="text-fg-muted">·</span>
          <span className="truncate text-sm text-fg-muted">Device console</span>
        </div>
        <Link
          href={`/dashboard/devices/${encodeURIComponent(agentId)}`}
          className="shrink-0 text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          ← Back to Vantra
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {plan === "premium" ? (
          <RemoteTools agentId={agentId} isStaff={user.isStaff} fullHeight />
        ) : (
          <div className="p-4">
            <RemoteToolsLocked />
          </div>
        )}
      </div>
    </div>
  );
}
