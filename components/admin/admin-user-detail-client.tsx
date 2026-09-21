"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { GrantPremiumButton } from "@/components/admin/grant-premium-button";
import { GrantPrivateOrgButton } from "@/components/admin/grant-private-org-button";
import { ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Td, Th } from "@/components/ui";

export interface AdminUserDetail {
  userId: string;
  email: string;
  emailVerified: boolean;
  isStaff: boolean;
  createdAt: string;
  orgs: Array<{
    orgId: string;
    orgName: string;
    plan: string;
    premiumExpiresAt: string | null;
    isActiveOrg: boolean;
    agentDomainTier: string;
    deviceCount: number;
  }>;
}

/**
 * Per-user admin detail page client: shows the user's account info with a
 * Grant/Revoke staff toggle, and their organizations each with a Grant Premium
 * button (reusing the shared GrantPremiumButton). Links out to Payments/Tickets
 * rather than embedding their histories inline, keeping this page scoped.
 */
export function AdminUserDetailClient({ user }: { user: AdminUserDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffWorking, setStaffWorking] = useState(false);

  async function setStaff(isStaff: boolean) {
    setStaffWorking(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(user.userId)}/set-staff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isStaff }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't update staff access.", "error");
        return;
      }
      toast.push(
        isStaff ? "Staff access granted." : "Staff access revoked.",
        "success",
      );
      setStaffOpen(false);
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setStaffWorking(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl p-5">
        <h2 className="text-lg font-bold text-fg">Account</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-muted">Email</dt>
            <dd className="font-medium text-fg">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-muted">Verified</dt>
            <dd>
              {user.emailVerified ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <Badge tone="warning">Unverified</Badge>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-fg-muted">Created</dt>
            <dd className="text-fg">
              {new Date(user.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
            <dt className="flex items-center gap-2 text-fg-muted">
              Staff access
              <Badge tone={user.isStaff ? "success" : "neutral"}>
                {user.isStaff ? "Staff" : "Customer"}
              </Badge>
            </dt>
            <dd>
              <Button
                variant={user.isStaff ? "danger" : "primary"}
                type="button"
                className="px-3 py-1.5 text-xs"
                onClick={() => setStaffOpen(true)}
              >
                {user.isStaff ? "Revoke staff access" : "Grant staff access"}
              </Button>
            </dd>
          </div>
        </dl>
      </Card>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-fg">Organizations</h2>
            <p className="mt-1 text-xs text-fg-muted">
              {user.orgs.length} organization{user.orgs.length === 1 ? "" : "s"}.
              Grant Premium is only available for orgs currently on the free plan —
              renewal isn&apos;t an admin action.
            </p>
          </div>
          <GrantPrivateOrgButton userId={user.userId} />
        </div>
        {user.orgs.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">
            This user has no organizations yet (not fully provisioned).
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full divide-y divide-border text-left text-sm">
              <thead>
                <tr>
                  <Th>Organization</Th>
                  <Th>Tier</Th>
                  <Th>Plan</Th>
                  <Th>Premium expires</Th>
                  <Th>Devices</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {user.orgs.map((o) => (
                  <tr key={o.orgId}>
                    <Td className="text-fg">
                      {o.orgName || "— (unnamed)"}
                      {o.isActiveOrg && (
                        <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                          active
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={o.agentDomainTier === "private" ? "warning" : "neutral"}>
                        {o.agentDomainTier}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={o.plan === "premium" ? "success" : "neutral"}>
                        {o.plan}
                      </Badge>
                    </Td>
                    <Td className="text-fg-muted">
                      {o.premiumExpiresAt
                        ? new Date(o.premiumExpiresAt).toLocaleDateString()
                        : "—"}
                    </Td>
                    <Td className="text-fg">
                      {o.deviceCount === -1 ? (
                        <span
                          className="text-fg-muted"
                          title="Couldn't reach TRMM for this org"
                        >
                          —
                        </span>
                      ) : (
                        o.deviceCount
                      )}
                    </Td>
                    <Td className="text-right">
                      <GrantPremiumButton orgId={o.orgId} plan={o.plan} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex gap-3 text-sm">
        <Link
          href="/admin101/payments"
          className="text-brand-600 hover:underline dark:text-brand-400"
        >
          View payments
        </Link>
        <Link
          href="/admin101/tickets"
          className="text-brand-600 hover:underline dark:text-brand-400"
        >
          View tickets
        </Link>
      </div>

      <ConfirmDialog
        open={staffOpen}
        onClose={() => !staffWorking && setStaffOpen(false)}
        onConfirm={() => setStaff(user.isStaff ? false : true)}
        title={user.isStaff ? "Revoke staff access?" : "Grant staff access?"}
        description={
          user.isStaff
            ? "This removes their access to technician-only tooling (Connect to Backend, Terminal, Start Maintenance). Their premium plan is unaffected."
            : "This grants technician-only access (Connect to Backend, Terminal, Start Maintenance) across premium devices they can already view. They still must be premium for the underlying routes."
        }
        confirmLabel={user.isStaff ? "Revoke staff" : "Grant staff"}
        confirmVariant={user.isStaff ? "danger" : "primary"}
        confirming={staffWorking}
      />
    </div>
  );
}