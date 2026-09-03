import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Lists all users with a device (Deployment) count, for the admin Users page.
 * Self-guarded — every admin API route (except login) calls requireAdminSession().
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

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

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      orgName: u.orgName,
      plan: u.plan,
      premiumExpiresAt: u.premiumExpiresAt?.toISOString() ?? null,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt.toISOString(),
      deviceCount: u._count.deployments,
    })),
  );
}