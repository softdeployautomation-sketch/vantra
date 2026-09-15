import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { extendPremium } from "@/lib/premium";
import { getCurrentUser } from "@/lib/session-user";
import { getPremiumPricing } from "@/lib/wallet-settings";

export const dynamic = "force-dynamic";

/**
 * Activates Premium on a specific org the caller owns. Requires the caller's
 * wallet balance to cover the admin-configured activation price (was a
 * hardcoded $100, now read live from AdminSetting on every request — an admin
 * price change takes effect on the very next call, no restart) and the org
 * currently on the free plan. Deducts exactly that price and extends premium
 * by 30 days in a single transaction. Another org owned by the same user is
 * unaffected — this is strictly a per-org spend.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  const { orgId } = await params;
  const org = await db.organization.findUnique({ where: { id: orgId } });
  // Ownership check — 404 (not 403) so another customer's org isn't leaked.
  if (!org || org.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (org.plan !== "free") {
    return NextResponse.json(
      { error: "This organization is already on the Premium plan." },
      { status: 409 },
    );
  }

  const { activatePremiumCents } = await getPremiumPricing();

  // Best-effort friendly message only — NOT the real balance gate (see below).
  if (user.walletBalanceCents < activatePremiumCents) {
    const missing = (activatePremiumCents - user.walletBalanceCents) / 100;
    return NextResponse.json(
      {
        error: `Not enough wallet balance. Add $${missing.toFixed(2)} more to activate Premium.`,
      },
      { status: 409 },
    );
  }

  // The real gate: updateMany's where-clause re-checks the balance at the
  // moment this transaction actually runs and only decrements if it's still
  // sufficient, closing the check-then-act race two concurrent activations
  // (or an activation racing a renewal) could otherwise exploit to double-spend
  // a balance that should only cover one action. Uses the SAME price read
  // above for both the gate and the decrement, so a mid-request admin price
  // change can never charge a different amount than what was quoted.
  const result = await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: user.id, walletBalanceCents: { gte: activatePremiumCents } },
      data: { walletBalanceCents: { decrement: activatePremiumCents } },
    });
    if (count === 0) return null;
    const premiumExpiresAt = await extendPremium(orgId, tx);
    const updated = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { walletBalanceCents: true },
    });
    return { premiumExpiresAt, walletBalanceCents: updated.walletBalanceCents };
  });

  if (!result) {
    return NextResponse.json(
      { error: "Not enough wallet balance to activate Premium." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    premiumExpiresAt: result.premiumExpiresAt.toISOString(),
    walletBalanceCents: result.walletBalanceCents,
  });
}