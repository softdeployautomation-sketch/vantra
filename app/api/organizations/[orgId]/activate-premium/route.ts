import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { extendPremium } from "@/lib/premium";
import { getCurrentUser } from "@/lib/session-user";

export const dynamic = "force-dynamic";

export const ACTIVATE_PREMIUM_CENTS = 10_000; // $100 — first 30 days included

/**
 * Activates Premium on a specific org the caller owns. Requires the caller's
 * wallet balance ≥ $100 and the org currently on the free plan. Deducts exactly
 * $100 and extends premium by 30 days in a single transaction. Another org owned
 * by the same user is unaffected — this is strictly a per-org spend.
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
  // Best-effort friendly message only — NOT the real balance gate (see below).
  if (user.walletBalanceCents < ACTIVATE_PREMIUM_CENTS) {
    const missing = (ACTIVATE_PREMIUM_CENTS - user.walletBalanceCents) / 100;
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
  // a balance that should only cover one action.
  const result = await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: user.id, walletBalanceCents: { gte: ACTIVATE_PREMIUM_CENTS } },
      data: { walletBalanceCents: { decrement: ACTIVATE_PREMIUM_CENTS } },
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