import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { extendPremium } from "@/lib/premium";

export const dynamic = "force-dynamic";

/**
 * Admin grants premium to a single ORGANIZATION: extends it by 30 days (from
 * max(now, current expiry) so early renewals stack) and flips the plan to
 * "premium", exactly the same path the customer's own Activate/Renew flow uses.
 * Reuses extendPremium() rather than reimplementing any of the stacking logic.
 * Grant-only — no revoke, matching the product decision that premium lapses
 * naturally via premiumExpiresAt. Self-guarded via requireAdminSession().
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { orgId } = await params;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const premiumExpiresAt = await extendPremium(orgId);
  return NextResponse.json({ premiumExpiresAt: premiumExpiresAt.toISOString() });
}