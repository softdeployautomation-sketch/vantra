import { NextResponse } from "next/server";
import { z } from "zod";

import { getLivePrices } from "@/lib/crypto-verify";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";
import { getWalletAddresses } from "@/lib/wallet-settings";

const MAX_TOP_UP_USD = 5000;

/** A still-fresh pending quote is reusable for up to 2h (per plan §V4.1). */
const QUOTE_FRESH_MS = 2 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  method: z.enum(["btc", "usdt_trc20"]),
  amountUsd: z
    .number()
    .int("Amount must be a whole number of dollars")
    .min(1, "Top-up amount must be at least $1")
    .max(MAX_TOP_UP_USD, `Top-up amount can't exceed $${MAX_TOP_UP_USD}`),
});

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

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

  return createCryptoQuote(user, parsed.method, parsed.amountUsd);
}

async function createCryptoQuote(
  user: CurrentUser,
  method: "btc" | "usdt_trc20",
  amountUsd: number,
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

  // Reuse a still-fresh pending quote for this user+method+amount rather than
  // re-quoting on every click — the customer keeps the same frozen price during
  // an in-flight payment.
  const freshQuote = await db.payment.findFirst({
    where: {
      userId: user.id,
      method,
      amountUsd,
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
      kind: "topup",
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