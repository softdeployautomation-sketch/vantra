"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { GrantPremiumButton } from "@/components/admin/grant-premium-button";
import { DeleteOrgButton } from "@/components/admin/delete-org-button";
import { GrantPrivateOrgButton } from "@/components/admin/grant-private-org-button";
import { ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Td, Th } from "@/components/ui";

// Task 82: the known public agent-host set (mirrors lib/agent-domains.ts —
// duplicated here because that module is server-only via its env import).
const KNOWN_AGENT_HOSTS = ["agent.broks.beauty", "agent.instaweb.top"] as const;

/**
 * Task 82 — per-org public agent-host allowlist editor. Checkboxes over the
 * known public host set; PATCH /api/admin/organizations/[orgId]/agent-hosts
 * persists the (server-validated) list. Private orgs are read-only — the
 * private API host is not user-selectable (Task 61).
 */
function AgentHostsEditor({
  orgId,
  tier,
  initial,
}: {
  orgId: string;
  tier: string;
  initial: string[];
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>(() =>
    initial.filter((h): h is (typeof KNOWN_AGENT_HOSTS)[number] =>
      (KNOWN_AGENT_HOSTS as readonly string[]).includes(h),
    ),
  );
  const [working, setWorking] = useState(false);
  const isPrivate = tier === "private";

  if (isPrivate) {
    return <span className="text-xs text-fg-muted">private host (fixed)</span>;
  }

  async function save() {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/organizations/${encodeURIComponent(orgId)}/agent-hosts`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentApiHosts: selected }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't update agent hosts.", "error");
        return;
      }
      toast.push("Agent hosts updated.", "success");
    } catch {
      toast.push("Network error — try again.", "error");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {KNOWN_AGENT_HOSTS.map((host) => (
        <label key={host} className="flex items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={selected.includes(host)}
            onChange={(e) =>
              setSelected((cur) =>
                e.target.checked ? [...cur, host] : cur.filter((h) => h !== host),
              )
            }
          />
          {host}
        </label>
      ))}
      <Button
        variant="secondary"
        type="button"
        disabled={working || selected.length === 0}
        className="mt-1 w-fit px-2 py-1 text-xs"
        onClick={() => void save()}
      >
        {working ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

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
    agentApiHosts: string[];
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
                  <Th>Agent hosts</Th>
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
                      <AgentHostsEditor
                        orgId={o.orgId}
                        tier={o.agentDomainTier}
                        initial={o.agentApiHosts}
                      />
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
                      <span className="inline-flex items-center gap-2">
                        <GrantPremiumButton orgId={o.orgId} plan={o.plan} />
                        <DeleteOrgButton orgId={o.orgId} />
                      </span>
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