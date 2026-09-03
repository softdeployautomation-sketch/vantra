import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "./db";

const PREMIUM_DAYS_PER_CHARGE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Extends an ORGANIZATION's premium by 30 days from max(now, current expiry) so
 * early renewals stack rather than reset. Sets the org plan to "premium".
 * Shared by the OpenNode webhook, the manual-crypto verification path, and the
 * admin manual-payment-review box. Returns the new premiumExpiresAt date.
 *
 * Premium is per-organization (each org is its own subscription target); the
 * wallet itself stays shared on User and is a separate follow-up task.
 *
 * When called with a transaction client (webhook), the org update runs inside
 * the caller's transaction so the payment-status + premium extension stay
 * atomic — preserving the original webhook behavior exactly.
 */
export async function extendPremium(
  organizationId: string,
  tx?: Prisma.TransactionClient,
): Promise<Date> {
  const client = tx ?? db;
  const org = await client.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const now = new Date();
  const base =
    org.premiumExpiresAt && org.premiumExpiresAt.getTime() > now.getTime()
      ? org.premiumExpiresAt
      : now;
  const premiumExpiresAt = new Date(
    base.getTime() + PREMIUM_DAYS_PER_CHARGE * DAY_MS,
  );
  await client.organization.update({
    where: { id: organizationId },
    data: { plan: "premium", premiumExpiresAt },
  });
  return premiumExpiresAt;
}

/**
 * Resolves which ORGANIZATION id a user's payment/charge should grant premium
 * to: the user's active org, falling back to their first org. A payment is
 * user-scoped, but premium lands on (at least) the active org. Returns null if
 * the user has no org at all.
 */
export async function resolveActiveOrgId(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, activeOrgId: true },
  });
  if (!user) return null;
  if (user.activeOrgId) {
    const org = await client.organization.findUnique({ where: { id: user.activeOrgId } });
    if (org && org.ownerId === userId) return org.id;
  }
  const first = await client.organization.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

export { PREMIUM_DAYS_PER_CHARGE, DAY_MS }