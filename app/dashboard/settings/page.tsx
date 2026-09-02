import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BillingCard } from "@/components/billing-card";
import { SettingsForm } from "@/components/settings-form";
import { getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const user = await getCurrentUser();
  // Parent dashboard layout already gates auth/verify/onboarding; re-check for
  // type-safety so we never render with a null user.
  if (!user) redirect("/login");

  const { upgraded } = await searchParams;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-fg">Settings</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Manage your organization, plan and preferences.
      </p>
      {upgraded && (
        <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Payment successful — your Premium upgrade is being processed and will
          activate shortly.
        </div>
      )}
      <div className="mt-6 space-y-6">
        <BillingCard
          plan={user.plan}
          premiumExpiresAt={user.premiumExpiresAt?.toISOString() ?? null}
        />
        <SettingsForm
          initialOrgName={user.orgName || ""}
          email={user.email}
          initialNotifyDeviceOffline={user.notifyDeviceOffline}
          initialNotifyTicketReply={user.notifyTicketReply}
        />
      </div>
    </div>
  );
}