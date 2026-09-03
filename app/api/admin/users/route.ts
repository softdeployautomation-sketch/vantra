import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Lists all users with a device (Deployment) count, for the admin Users page,
 * joined with their organizations so the per-org plan/premium/name can be shown
 * (prefers the active org, else their first). Self-guarded — every admin API
 * route (except login) calls requireAdminSession().
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

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

  return NextResponse.json(
    users.map((u) => {
      const active =
        u.organizations.find((o) => o.id === u.activeOrgId) ?? u.organizations[0];
      return {
        id: u.id,
        email: u.email,
        orgName: active?.name ?? null,
        plan: active?.plan ?? "free",
        premiumExpiresAt: active?.premiumExpiresAt?.toISOString() ?? null,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
        deviceCount: u.organizations.reduce((sum, o) => sum + o._count.deployments, 0),
      };
    }),
  );
}