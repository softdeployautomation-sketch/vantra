import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AgentDetailClient } from "@/components/agent-detail-client";
import { canAccessAgent } from "@/lib/authz";
import { getCurrentUser } from "@/lib/session-user";

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
  if (!user.orgName) redirect("/onboarding");

  // IDOR guard: staff may view any agent; customers only their own client's.
  // notFound() renders a 404 without revealing whether the agent exists.
  const allowed = await canAccessAgent(agentId, user);
  if (!allowed) notFound();

  return (
    <div>
      <Link href="/dashboard" className="text-sm text-brand-600 hover:underline">
        ← Back to devices
      </Link>
      <div className="mt-6">
        <AgentDetailClient agentId={agentId} isStaff={user.isStaff} />
      </div>
    </div>
  );
}