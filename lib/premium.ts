import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "./db";

const PREMIUM_DAYS_PER_CHARGE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Extends a user's premium by 30 days from max(now, current expiry) so early
 * renewals stack rather than reset. Sets plan to "premium". Shared by the
 * OpenNode webhook and the manual-crypto verification path. Returns the new
 * premiumExpiresAt date.
 *
 * When called with a transaction client (webhook), the user update runs inside
 * the caller's transaction so the payment-status + premium extension stay
 * atomic — preserving the original webhook behavior exactly.
 */
export async function extendPremium(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<Date> {
  const client = tx ?? db;
  const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
  const now = new Date();
  const base =
    user.premiumExpiresAt && user.premiumExpiresAt.getTime() > now.getTime()
      ? user.premiumExpiresAt
      : now;
  const premiumExpiresAt = new Date(
    base.getTime() + PREMIUM_DAYS_PER_CHARGE * DAY_MS,
  );
  await client.user.update({
    where: { id: userId },
    data: { plan: "premium", premiumExpiresAt },
  });
  return premiumExpiresAt;
}

export { PREMIUM_DAYS_PER_CHARGE, DAY_MS }