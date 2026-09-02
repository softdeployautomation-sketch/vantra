import { NextResponse } from "next/server";

import { billingConfigured, createCharge } from "@/lib/billing";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";

const INITIAL_CHARGE_USD = 100;
const RENEWAL_CHARGE_USD = 29;

export const dynamic = "force-dynamic";

/**
 * Kicks off a Vantra Premium charge (OpenNode hosted checkout). Creates the
 * Payment ledger row first (its id becomes OpenNode's order_id, so the webhook
 * can always find it), then redirects the customer to OpenNode's hosted checkout.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Distinguish an initial purchase from a renewal by whether the user has ever
  // had a premiumExpiresAt (stacking renewals extend from max(now, current)).
  const kind = user.premiumExpiresAt ? "renewal" : "initial";

  // Reconciliation of the plan's two requirements: "reject if already premium"
  // (don't let an actively-premium account buy a second initial charge) coexists
  // with the documented "Renew before/after it lapses" flow — renewals are
  // allowed and merely stack from max(now, current expiry). See plan §V4.
  if (kind === "initial" && user.plan === "premium") {
    return NextResponse.json(
      { error: "Your account is already on the Premium plan." },
      { status: 409 },
    );
  }

  if (!billingConfigured()) {
    return NextResponse.json(
      { error: "Payments aren't available yet — the billing processor isn't configured. Please try again later." },
      { status: 503 },
    );
  }

  const amountUsd = kind === "initial" ? INITIAL_CHARGE_USD : RENEWAL_CHARGE_USD;

  const payment = await db.payment.create({
    data: { userId: user.id, amountUsd, kind },
  });

  try {
    const charge = await createCharge({
      amountUsd,
      orderId: payment.id,
      customerEmail: user.email,
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { openNodeChargeId: charge.id },
    });
    return NextResponse.json({ checkoutUrl: charge.hosted_checkout_url });
  } catch (err) {
    console.error("createCharge failed:", err);
    // Leave the Payment row as "pending" but unused; surface a friendly error.
    return NextResponse.json(
      { error: "Couldn't start your checkout right now. Please try again." },
      { status: 502 },
    );
  }
}