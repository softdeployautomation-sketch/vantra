import { NextResponse } from "next/server";
import { z } from "zod";

import {
  type CryptoVerifyResult,
  verifyBtcPayment,
  verifyUsdtPayment,
} from "@/lib/crypto-verify";
import { db } from "@/lib/db";
import { extendPremium } from "@/lib/premium";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session-user";
import { notifyAdmin } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Within ±5% of the frozen expected crypto quantity (both derived from the price
// at order-creation time — the customer is not re-priced at verification time).
const TOLERANCE = 0.05;

const submitSchema = z.object({
  paymentId: z.string().min(1, "paymentId is required"),
  txHash: z
    .string()
    .trim()
    .min(1, "Transaction hash is required")
    .max(200, "Transaction hash is too long"),
});

/**
 * Customer submits a transaction hash for a manual (btc / usdt_trc20) payment,
 * which is verified live against the public block explorers. Every attempt is
 * audited to PaymentVerificationAttempt. Conclusive within-tolerance results
 * auto-extend premium; obviously-wrong hashes auto-reject; genuine ambiguity
 * (amount out of tolerance) is flagged for admin review.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  const ip = await getClientIp();
  const allowed = await allowAndRecord(ip, "billing-manual-submit");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts. Please try again later." },
      { status: 429 },
    );
  }

  let parsed;
  try {
    parsed = submitSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const payment = await db.payment.findUnique({ where: { id: parsed.paymentId } });
  if (!payment || payment.userId !== user.id) {
    // Don't leak whether another customer's payment exists.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (payment.method !== "btc" && payment.method !== "usdt_trc20") {
    return NextResponse.json(
      { error: "This payment isn't a manual crypto payment." },
      { status: 400 },
    );
  }
  if (payment.status === "paid") {
    return NextResponse.json(
      { error: "This payment has already been completed." },
      { status: 400 },
    );
  }

  // A txHash must never be reusable across different orders (unique DB-wide).
  const reused = await db.payment.findFirst({
    where: { txHash: parsed.txHash, id: { not: payment.id } },
  });
  if (reused) {
    return NextResponse.json(
      { error: "This transaction hash has already been used for another order." },
      { status: 409 },
    );
  }

  const expectedAddress = payment.walletAddress;
  if (!expectedAddress) {
    return NextResponse.json(
      { error: "This payment has no configured wallet address." },
      { status: 400 },
    );
  }

  // The verifier functions catch internally and return fetch_error rather than
  // throwing, so `result` is always populated here.
  const result: CryptoVerifyResult =
    payment.method === "btc"
      ? await verifyBtcPayment(parsed.txHash, expectedAddress)
      : await verifyUsdtPayment(parsed.txHash, expectedAddress);

  await db.paymentVerificationAttempt.create({
    data: {
      paymentId: payment.id,
      txHash: parsed.txHash,
      outcome: mapOutcome(result),
      resultJson: JSON.stringify(result),
    },
  });

  // Not-found / not-confirmed / fetch-error — leave pending; the customer retries.
  // Not binding this hash yet so a corrected hash can still be submitted.
  if (!result.ok) {
    if (
      result.reason === "wrong_contract" ||
      result.reason === "address_mismatch"
    ) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          verificationStatus: "rejected",
          txHash: parsed.txHash,
          confirmations: result.confirmations,
        },
      });
      return NextResponse.json(
        { error: "This transaction doesn't match your payment. Please check the address and try again." },
        { status: 422, headers: { "X-Vantra-Verification": "rejected" } },
      );
    }
    // not_confirmed / not_found / fetch_error
    await db.payment.update({
      where: { id: payment.id },
      data: { verificationStatus: "pending" },
    });
    const msg =
      result.reason === "not_confirmed"
        ? "This transaction isn't confirmed on-chain yet. Please try again once it confirms."
        : result.reason === "fetch_error"
          ? "We couldn't reach the block explorer right now. Please try again."
          : "We couldn't find this transaction on-chain. Please check the hash and try again.";
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  // Conclusive verification result.
  const expected = payment.expectedAmountCrypto;
  const actual = result.actualAmountCrypto;
  const withinTolerance =
    expected != null &&
    actual > 0 &&
    actual >= expected * (1 - TOLERANCE) &&
    actual <= expected * (1 + TOLERANCE);
  const actualAmountUsd =
    expected != null
      ? Number((actual * (payment.priceAtOrderUsd ?? 0)).toFixed(2))
      : null;

  if (withinTolerance) {
    const premiumExpiresAt = await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "paid",
          verificationStatus: "auto_approved",
          txHash: parsed.txHash,
          confirmations: result.confirmations,
          actualAmountUsd,
        },
      });
      return extendPremium(user.id, tx);
    });
    return NextResponse.json(
      { verificationStatus: "auto_approved", premiumExpiresAt },
      { status: 200, headers: { "X-Vantra-Verification": "auto_approved" } },
    );
  }

  // Amount outside tolerance — genuine ambiguity, flags for admin review.
  await db.payment.update({
    where: { id: payment.id },
    data: {
      verificationStatus: "flagged",
      txHash: parsed.txHash,
      confirmations: result.confirmations,
      actualAmountUsd,
    },
  });
  // Fire-and-forget admin alert — a Telegram hiccup must never fail this request.
  void notifyAdmin(
    `⚠️ Payment needs review: ${payment.method} for user ${user.email}, $${payment.amountUsd}. Check /admin101/payments.`,
  );
  return NextResponse.json(
    {
      verificationStatus: "flagged",
      error:
        "Payment received, but the amount doesn't match your quote. It's been flagged for manual review and will be resolved shortly.",
    },
    { status: 202, headers: { "X-Vantra-Verification": "flagged" } },
  );
}

function mapOutcome(result: CryptoVerifyResult): string {
  if (result.ok) return "auto_approved";
  return result.reason ?? "not_found";
}