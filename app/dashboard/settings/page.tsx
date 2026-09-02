import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsForm } from "@/components/settings-form";
import { getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  // Parent dashboard layout already gates auth/verify/onboarding; re-check for
  // type-safety so we never render with a null user.
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-fg">Settings</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Manage your organization and preferences.
      </p>
      <div className="mt-6">
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