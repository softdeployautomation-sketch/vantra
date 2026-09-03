import type { Metadata } from "next";

import { Badge, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Admin · Users" };

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      orgName: true,
      plan: true,
      premiumExpiresAt: true,
      emailVerified: true,
      createdAt: true,
      _count: { select: { deployments: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Users</h1>
      <p className="mt-1 text-sm text-fg-muted">
        All customer accounts ({users.length}).
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
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <span className="font-medium text-fg">{u.email}</span>
                  {!u.emailVerified && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      unverified
                    </span>
                  )}
                </Td>
                <Td className="text-fg-muted">{u.orgName ?? "—"}</Td>
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
                <Td className="text-fg">{u._count.deployments}</Td>
              </tr>
            ))}
            {users.length === 0 && (
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