"use client";

import Link from "next/link";

import { GrantPremiumButton } from "@/components/admin/grant-premium-button";
import { Badge, Td, Th } from "@/components/ui";

export interface AdminUserOrgRow {
  userId: string;
  email: string;
  emailVerified: boolean;
  isStaff: boolean;
  orgId: string | null;
  orgName: string | null;
  isActiveOrg: boolean;
  plan: string;
  premiumExpiresAt: string | null;
  deviceCount: number;
}

/**
 * Interactive Users list. The server page fetches the users + per-org device
 * counts and passes them here as `initial`; this client owns the interactive
 * bits — email links to the per-user detail page, the staff badge, and the
 * per-org Grant Premium buttons (via the shared GrantPremiumButton).
 */
export function AdminUsersClient({ rows }: { rows: AdminUserOrgRow[] }) {
  const userIndexByUserId = new Map<string, number>();
  Array.from(new Set(rows.map((r) => r.userId))).forEach((id, i) =>
    userIndexByUserId.set(id, i),
  );

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <thead>
          <tr>
            <Th>Email</Th>
            <Th>Staff</Th>
            <Th>Org</Th>
            <Th>Plan</Th>
            <Th>Premium expires</Th>
            <Th>Devices</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((u, i) => {
            const isFirstOfGroup = i === 0 || rows[i - 1].userId !== u.userId;
            const groupSize = rows.filter((r) => r.userId === u.userId).length;
            const userIndex = userIndexByUserId.get(u.userId) ?? 0;
            const groupShade =
              userIndex % 2 === 1 ? "bg-black/[0.015] dark:bg-white/[0.02]" : "";
            return (
              <tr
                key={u.orgId ?? u.userId}
                className={
                  groupShade +
                  (isFirstOfGroup && i > 0 ? " border-t-2 border-t-border" : "")
                }
              >
                {isFirstOfGroup ? (
                  <>
                    <Td rowSpan={groupSize} className="align-top">
                      <Link
                        href={`/admin101/users/${u.userId}`}
                        className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {u.email}
                      </Link>
                      {!u.emailVerified && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          unverified
                        </span>
                      )}
                      {groupSize > 1 && (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {groupSize} organizations
                        </span>
                      )}
                    </Td>
                    <Td rowSpan={groupSize} className="align-top">
                      <Badge tone={u.isStaff ? "success" : "neutral"}>
                        {u.isStaff ? "Staff" : "Customer"}
                      </Badge>
                    </Td>
                  </>
                ) : null}
                <Td className="text-fg-muted">
                  {u.orgName ?? "— (not provisioned)"}
                  {u.isActiveOrg && (
                    <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      active
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={u.plan === "premium" ? "success" : "neutral"}>
                    {u.plan}
                  </Badge>
                </Td>
                <Td className="text-fg-muted">
                  {u.premiumExpiresAt
                    ? new Date(u.premiumExpiresAt).toLocaleDateString()
                    : "—"}
                </Td>
                <Td className="text-fg">
                  {u.deviceCount === -1 ? (
                    <span
                      className="text-fg-muted"
                      title="Couldn't reach TRMM for this org"
                    >
                      —
                    </span>
                  ) : (
                    u.deviceCount
                  )}
                </Td>
                <Td className="text-right">
                  {u.orgId ? (
                    <GrantPremiumButton orgId={u.orgId} plan={u.plan} />
                  ) : null}
                </Td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={7} className="text-center text-fg-muted">
                No users yet.
              </Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}