import type { Metadata } from "next";

import { Badge, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Admin · Users" };

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      organizations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          plan: true,
          premiumExpiresAt: true,
          _count: { select: { deployments: true } },
        },
      },
    },
  });

  interface OrgRow {
    userId: string;
    email: string;
    emailVerified: boolean;
    orgId: string | null;
    orgName: string | null;
    isActiveOrg: boolean;
    plan: string;
    premiumExpiresAt: Date | null;
    deviceCount: number;
  }

  // One row PER ORGANIZATION, not per user — collapsing a multi-org user down
  // to just their active (or first) org hid every other org's plan/premium
  // status/device count from admin view entirely. A user with no orgs yet
  // (not fully provisioned) still gets one placeholder row so they're visible.
  const rows: OrgRow[] = users.flatMap((u): OrgRow[] =>
    u.organizations.length > 0
      ? u.organizations.map((o) => ({
          userId: u.id,
          email: u.email,
          emailVerified: u.emailVerified,
          orgId: o.id,
          orgName: o.name,
          isActiveOrg: o.id === u.activeOrgId,
          plan: o.plan,
          premiumExpiresAt: o.premiumExpiresAt,
          deviceCount: o._count.deployments,
        }))
      : [
          {
            userId: u.id,
            email: u.email,
            emailVerified: u.emailVerified,
            orgId: null,
            orgName: null,
            isActiveOrg: false,
            plan: "free",
            premiumExpiresAt: null,
            deviceCount: 0,
          },
        ],
  );


  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Users</h1>
      <p className="mt-1 text-sm text-fg-muted">
        All customer accounts ({users.length}) — {rows.length} organization
        {rows.length === 1 ? "" : "s"}. One row per organization; a multi-org
        account shows one row per org it owns.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
        <table className="min-w-full divide-y divide-border text-left text-sm">
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Org</Th>
              <Th>Plan</Th>
              <Th>Premium expires</Th>
              <Th>Devices</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((u, i) => {
              const isFirstOfGroup = i === 0 || rows[i - 1].userId !== u.userId;
              const groupSize = rows.filter((r) => r.userId === u.userId).length;
              // Alternate a faint background per USER group (not per row) so
              // a multi-org user's rows read as one visual block, with a
              // slightly heavier top border marking where each new user starts.
              const userIndex = Array.from(new Set(rows.map((r) => r.userId))).indexOf(u.userId);
              const groupShade = userIndex % 2 === 1 ? "bg-black/[0.015] dark:bg-white/[0.02]" : "";
              return (
                <tr
                  key={u.orgId ?? u.userId}
                  className={groupShade + (isFirstOfGroup && i > 0 ? " border-t-2 border-t-border" : "")}
                >
                  {isFirstOfGroup ? (
                    <Td rowSpan={groupSize} className="align-top">
                      <span className="font-medium text-fg">{u.email}</span>
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
                      ? u.premiumExpiresAt.toLocaleDateString()
                      : "—"}
                  </Td>
                  <Td className="text-fg">{u.deviceCount}</Td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <Td colSpan={5} className="text-center text-fg-muted">
                  No users yet.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}