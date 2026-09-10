import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminUserDetailClient,
  type AdminUserDetail,
} from "@/components/admin/admin-user-detail-client";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/trmm";

export const metadata: Metadata = { title: "Admin · User" };

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const user = await db.user.findUnique({
    where: { id: userId },
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
  if (!user) notFound();

  // Real registered TRMM devices, not raw Deployment rows — matches the Users
  // list page's counting so both views agree about "how many devices."
  const allClientIds = user.organizations
    .map((o) => o.trmmClientId)
    .filter((id): id is number => id != null);
  const deviceCounts = new Map<number, number>();
  await Promise.all(
    Array.from(new Set(allClientIds)).map(async (clientId) => {
      try {
        const agents = await listAgents(clientId);
        deviceCounts.set(clientId, agents.length);
      } catch {
        deviceCounts.set(clientId, -1);
      }
    }),
  );

  const detail: AdminUserDetail = {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    isStaff: user.isStaff,
    createdAt: user.createdAt.toISOString(),
    orgs: user.organizations.map((o) => ({
      orgId: o.id,
      orgName: o.name,
      plan: o.plan,
      premiumExpiresAt: o.premiumExpiresAt?.toISOString() ?? null,
      isActiveOrg: o.id === user.activeOrgId,
      deviceCount:
        o.trmmClientId != null ? (deviceCounts.get(o.trmmClientId) ?? 0) : 0,
    })),
  };

  return (
    <div>
      <Link
        href="/admin101/users"
        className="text-sm text-brand-600 hover:underline"
      >
        ← Back to users
      </Link>
      <div className="mt-4">
        <AdminUserDetailClient user={detail} />
      </div>
    </div>
  );
}