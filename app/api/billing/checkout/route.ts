import { NextResponse } from "next/server";
import { z } from "zod";

import { billingConfigured, createCharge } from "@/lib/billing";
import { getLivePrices } from "@/lib/crypto-verify";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { getWalletAddresses } from "@/lib/wallet-settings";

const INITIAL_CHARGE_USD = 100;
const RENEWAL_CHARGE_USD = 29;

/** A still-fresh pending quote is reusable for up to 2h (per plan §V4.1). */
const QUOTE_FRESH_MS = 2 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  method: z.enum(["opennode", "btc", "usdt_trc20"]).default("opennode"),
});

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Kicks off a Vantra Premium charge. Two paths:
 *  - "opennode" (default, preserves the existing no-body client call): creates
 *    the OpenNode hosted checkout, redirecting the customer there.
 *  - "btc" / "usdt_trc20": quotes a crypto payment against the configured
 *    static wallet address and returns the payment details for the manual
 *    on-chain verification flow (no checkoutUrl, no OpenNode).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  let parsed;
  try {
    parsed = checkoutSchema.parse(await request.json().catch(() => ({})));
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Premium is per-ORGANIZATION;the quote/kind and the "already premium" gate both
  // read the active org's subscription state (the Payment ledger row itself stays
  // user-scoped). The follow-up billing task will make purchases per-org explicitly.
  const org = await getActiveOrganization(user);
  const kind = org?.premiumExpiresAt ? "renewal" : "initial";

  // Reconciliation of the plan's two requirements: "reject if already premium"
  // (don't let an actively-premium org buy a second initial charge) coexists
  // with the documented "Renew before/after it lapses" flow — renewals are
  // allowed and merely stack from max(now, current expiry). See plan §V4.
  if (kind === "initial" && org?.plan === "premium") {
    return NextResponse.json(
      { error: "Your account is already on the Premium plan." },
      { status: 409 },
    );
  }

  if (parsed.method === "btc") {
    return createCryptoQuote(user, "btc", kind);
  }
  if (parsed.method === "usdt_trc20") {
    return createCryptoQuote(user, "usdt_trc20", kind);
  }

  return createOpenNodeCharge(user, kind);
}

async function createOpenNodeCharge(user: CurrentUser, kind: string) {
  if (!billingConfigured()) {
    return NextResponse.json(
      { error: "Payments aren't available yet — the billing processor isn't configured. Please try again later." },
      { status: 503 },
    );
  }

  const amountUsd = kind === "initial" ? INITIAL_CHARGE_USD : RENEWAL_CHARGE_USD;

  const payment = await db.payment.create({
    data: { userId: user.id, amountUsd, kind, method: "opennode" },
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

async function createCryptoQuote(
  user: CurrentUser,
  method: "btc" | "usdt_trc20",
  kind: string,
): Promise<NextResponse> {
  const wallets = await getWalletAddresses();
  const walletAddress =
    method === "btc" ? wallets.btcAddress : wallets.usdtTrc20Address;
  if (!walletAddress) {
    return NextResponse.json(
      { error: "Crypto payments aren't available yet — no wallet is configured." },
      { status: 503 },
    );
  }

  const amountUsd = kind === "initial" ? INITIAL_CHARGE_USD : RENEWAL_CHARGE_USD;

  // Reuse a still-fresh pending quote for this user+method+kind rather than
  // re-quoting on every click — the customer keeps the same frozen price during
  // an in-flight payment.
  const freshQuote = await db.payment.findFirst({
    where: {
      userId: user.id,
      method,
      kind,
      status: "pending",
      createdAt: { gte: new Date(Date.now() - QUOTE_FRESH_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (freshQuote) {
    return NextResponse.json({
      paymentId: freshQuote.id,
      method,
      walletAddress: freshQuote.walletAddress,
      expectedAmountCrypto: freshQuote.expectedAmountCrypto,
      expectedAmountUsd: freshQuote.amountUsd,
      priceAtOrderUsd: freshQuote.priceAtOrderUsd,
    });
  }

  let price: number;
  try {
    const prices = await getLivePrices();
    price = method === "btc" ? prices.btcUsd : prices.usdtUsd;
  } catch (err) {
    console.error("getLivePrices failed:", err);
    return NextResponse.json(
      { error: "Couldn't fetch a current crypto price right now. Please try again." },
      { status: 502 },
    );
  }

  const expectedAmountCrypto = Number((amountUsd / price).toFixed(8));
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      amountUsd,
      kind,
      method,
      walletAddress,
      priceAtOrderUsd: price,
      expectedAmountCrypto,
    },
  });

  return NextResponse.json({
    paymentId: payment.id,
    method,
    walletAddress,
    expectedAmountCrypto,
    expectedAmountUsd: amountUsd,
    priceAtOrderUsd: price,
  });
}