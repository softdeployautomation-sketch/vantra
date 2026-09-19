import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AgentDetailClient } from "@/components/agent-detail-client";
import { DesktopLockScreen } from "@/components/desktop-lock-screen";
import { canAccessAgent } from "@/lib/authz";
import { getDesktopModeGate } from "@/lib/desktop-mode";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Device" };

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
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

  // Desktop mode (2026-09-19) — see app/dashboard/page.tsx's comment; gated
  // directly in each page that shows device data, not the shared layout.
  const desktopGate = await getDesktopModeGate(user.id);
  if (desktopGate.gated) {
    return <DesktopLockScreen boundMachineLabel={desktopGate.boundMachineLabel} />;
  }

  // IDOR guard: staff may view any agent; customers only their active org's
  // client's. notFound() renders a 404 without revealing whether the agent exists.
  const allowed = await canAccessAgent(agentId, {
    isStaff: user.isStaff,
    trmmClientId: org?.trmmClientId ?? null,
  });
  if (!allowed) notFound();

  return (
    <div>
      <Link href="/dashboard" className="text-sm text-brand-600 hover:underline">
        ← Back to devices
      </Link>
      <div className="mt-6">
        <AgentDetailClient agentId={agentId} plan={org?.plan ?? "free"} isStaff={user.isStaff} />
      </div>
    </div>
  );
}