import type { Metadata } from "next";

import {
  AdminUsersClient,
  type AdminUserOrgRow,
} from "@/components/admin/admin-users-client";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";

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
          trmmClientId: true,
        },
      },
    },
  });

  // Real registered TRMM devices, not raw Deployment rows — Deployment counts
  // every installer LINK ever generated, including ones a customer clicked
  // "Add Device" for during testing but never actually ran on a machine.
  // Confirmed live 2026-09-06: a real account showed 5 Deployment rows in one
  // org against only 3 actual registered agents, reading as "2 missing
  // devices" when nothing was actually missing — the count itself was just
  // the wrong metric. This matches exactly what /api/devices (the customer's
  // own dashboard) shows, via the same listAgents() call, so admin and
  // customer views can no longer disagree about "how many devices."
  const allClientIds = users.flatMap((u) => u.organizations.map((o) => o.trmmClientId).filter((id): id is number => id != null));
  const deviceCounts = new Map<number, number>();
  await Promise.all(
    Array.from(new Set(allClientIds)).map(async (clientId) => {
      try {
        const agents = await listAgents(clientId);
        deviceCounts.set(clientId, agents.length);
      } catch {
        // TRMM unreachable for this one client — leave uncounted rather than
        // fail the whole admin page over one lookup.
        deviceCounts.set(clientId, -1);
      }
    }),
  );

  // One row PER ORGANIZATION, not per user — collapsing a multi-org user down
  // to just their active (or first) org hid every other org's plan/premium
  // status/device count from admin view entirely. A user with no orgs yet
  // (not fully provisioned) still gets one placeholder row so they're visible.
  const rows: AdminUserOrgRow[] = users.flatMap((u): AdminUserOrgRow[] =>
    u.organizations.length > 0
      ? u.organizations.map((o) => ({
          userId: u.id,
          email: u.email,
          emailVerified: u.emailVerified,
          isStaff: u.isStaff,
          orgId: o.id,
          orgName: o.name,
          isActiveOrg: o.id === u.activeOrgId,
          plan: o.plan,
          premiumExpiresAt: o.premiumExpiresAt?.toISOString() ?? null,
          deviceCount: o.trmmClientId != null ? (deviceCounts.get(o.trmmClientId) ?? 0) : 0,
        }))
      : [
          {
            userId: u.id,
            email: u.email,
            emailVerified: u.emailVerified,
            isStaff: u.isStaff,
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
        account shows one row per org it owns. Click an email to open the
        per-user page (grant/revoke staff, grant premium).
      </p>
      <AdminUsersClient rows={rows} />
    </div>
  );
}