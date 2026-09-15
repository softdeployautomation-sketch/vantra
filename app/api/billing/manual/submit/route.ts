import { NextResponse } from "next/server";
import { z } from "zod";

import {
  type CryptoVerifyResult,
  verifyBtcPayment,
  verifyUsdtPayment,
} from "@/lib/crypto-verify";
import { db } from "@/lib/db";
import { logApiError } from "@/lib/api-error-log";
import { adminAlertHtml, sendEmail, walletPendingHtml } from "@/lib/email";
import { env } from "@/lib/env";
import { logNotification } from "@/lib/notification-log";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session-user";
import { notifyAdmin } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const submitSchema = z.object({
  paymentId: z.string().min(1, "paymentId is required"),
  // Optional: a customer can say "I've sent it" without a hash (e.g. they
  // don't have it handy yet) — the payment still lands in admin review, just
  // with no on-chain pre-fill; the admin checks the wallet address manually.
  txHash: z
    .string()
    .trim()
    .max(200, "Transaction hash is too long")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/**
 * Customer submits a transaction hash for a manual (btc / usdt_trc20) top-up.
 * The hash is verified live against the public block explorers and every attempt
 * is audited to PaymentVerificationAttempt. A conclusive (confirmed-on-chain)
 * result — whether within the old ±5% tolerance or not — NEVER auto-grants
 * anything: it lands in a pending_review queue the admin must act on, with the
 * on-chain-detected amount recorded as an editable pre-fill suggestion. Obvious
 * errors (wrong contract, address mismatch) auto-reject; unresolved states (not
 * confirmed / not found / fetch error) stay pending so the customer can retry.
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
  if (payment.method !== "btc" && payment.method !== "usdt_trc20" && payment.method !== "usdt_erc20") {
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

  // A txHash must never be reusable across different orders (unique DB-wide) —
  // only applies when one was actually provided.
  if (parsed.txHash) {
    const reused = await db.payment.findFirst({
      where: { txHash: parsed.txHash, id: { not: payment.id } },
    });
    if (reused) {
      return NextResponse.json(
        { error: "This transaction hash has already been used for another order." },
        { status: 409 },
      );
    }
  }

  const expectedAddress = payment.walletAddress;
  if (!expectedAddress) {
    return NextResponse.json(
      { error: "This payment has no configured wallet address." },
      { status: 400 },
    );
  }

  // No hash provided: nothing to verify on-chain — go straight to admin review
  // with no pre-filled amount/confirmations. The admin checks the address's
  // incoming transactions manually before confirming.
  if (!parsed.txHash) {
    await db.paymentVerificationAttempt.create({
      data: {
        paymentId: payment.id,
        txHash: "",
        outcome: "no_hash_provided",
        resultJson: JSON.stringify({ ok: false, reason: "no_hash_provided" }),
      },
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { verificationStatus: "pending_review" },
    });
    await notifyAdminAndCustomer(payment, user, expectedAddress, undefined);
    return NextResponse.json(
      {
        verificationStatus: "pending_review",
        error:
          "Payment marked as sent — thanks! We'll review it and credit your wallet once confirmed.",
      },
      { status: 202, headers: { "X-Vantra-Verification": "pending_review" } },
    );
  }

  // USDT-ERC20 has no automated on-chain checker yet (verifyUsdtPayment only
  // covers TRC20/Tron, via Tronscan's public API) — go straight to admin
  // review the same way the no-hash path above does, but keep the hash the
  // customer gave (the admin still has it to check manually), never guess at
  // an on-chain result for a chain nothing here actually looks up.
  if (payment.method === "usdt_erc20") {
    await db.paymentVerificationAttempt.create({
      data: {
        paymentId: payment.id,
        txHash: parsed.txHash,
        outcome: "no_automated_verifier",
        resultJson: JSON.stringify({ ok: false, reason: "no_automated_verifier" }),
      },
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { verificationStatus: "pending_review", txHash: parsed.txHash },
    });
    await notifyAdminAndCustomer(payment, user, expectedAddress, parsed.txHash);
    return NextResponse.json(
      {
        verificationStatus: "pending_review",
        error:
          "Payment marked as sent — thanks! We'll review it and credit your wallet once confirmed.",
      },
      { status: 202, headers: { "X-Vantra-Verification": "pending_review" } },
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

  // Conclusive verification result (payment confirmed on-chain, present in the
  // expected wallet). Whether it's within the old ±5% tolerance or not, NEVER
  // auto-grants anything — it goes to the admin review queue and the on-chain
  // amount is recorded as an editable pre-fill suggestion for the admin.
  const expected = payment.expectedAmountCrypto;
  const actual = result.actualAmountCrypto;
  const actualAmountUsd =
    expected != null && payment.priceAtOrderUsd
      ? Number((actual * payment.priceAtOrderUsd).toFixed(2))
      : null;

  await db.payment.update({
    where: { id: payment.id },
    data: {
      verificationStatus: "pending_review",
      txHash: parsed.txHash,
      confirmations: result.confirmations,
      actualAmountUsd,
    },
  });

  await notifyAdminAndCustomer(payment, user, expectedAddress, parsed.txHash);

  return NextResponse.json(
    {
      verificationStatus: "pending_review",
      error:
        "Payment received — thanks! We'll review it and credit your wallet once confirmed.",
    },
    { status: 202, headers: { "X-Vantra-Verification": "pending_review" } },
  );
}

// Shared by both the with-hash and no-hash paths: alert BOTH admin channels
// with enough detail to act, and send the customer a pending-confirmation
// email. Never awaited by the caller for the admin side — a telegram/email
// hiccup must not fail the submit request; each send is logged for the admin
// audit tab regardless of outcome.
async function notifyAdminAndCustomer(
  payment: { id: string; method: string; amountUsd: number },
  user: { id: string; email: string },
  expectedAddress: string,
  txHash: string | undefined,
): Promise<void> {
  const txHashForDisplay = txHash ?? "(not provided)";
  void (async () => {
    const adminChatId = env.adminTelegramChatId;
    try {
      await notifyAdmin(buildAdminTelegramAlert(payment, user.email, txHash));
      if (adminChatId) {
        await logNotification({
          userId: user.id,
          eventType: "admin_alert",
          channel: "telegram",
          recipient: adminChatId,
          outcome: "sent",
        });
      }
    } catch (err) {
      if (adminChatId) {
        await logNotification({
          userId: user.id,
          eventType: "admin_alert",
          channel: "telegram",
          recipient: adminChatId,
          outcome: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })();
  if (env.adminAlertEmail) {
    void (async () => {
      try {
        await sendEmail({
          to: env.adminAlertEmail!,
          subject: `Payment awaiting review — ${user.email}`,
          html: adminAlertHtml({
            userEmail: user.email,
            amountUsd: payment.amountUsd,
            method: methodLabel(payment.method),
            txHash: txHashForDisplay,
            walletAddress: expectedAddress,
          }),
        });
        await logNotification({
          userId: user.id,
          eventType: "admin_alert",
          channel: "email",
          recipient: env.adminAlertEmail!,
          outcome: "sent",
        });
      } catch (err) {
        console.error("Payment pending-review admin email failed:", err);
        await logApiError({
          route: "/api/billing/manual/submit",
          method: "POST",
          statusCode: 500,
          error: err,
          userId: user.id,
          clientReceivedSuccess: true, // fire-and-forget admin alert — the submission itself already succeeded
        });
        await logNotification({
          userId: user.id,
          eventType: "admin_alert",
          channel: "email",
          recipient: env.adminAlertEmail!,
          outcome: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  // Pending-confirmation email to the customer.
  await sendPendingEmail({
    userId: user.id,
    to: user.email,
    amountUsd: payment.amountUsd,
    method: payment.method,
  });
}

function methodLabel(method: string): string {
  if (method === "btc") return "Bitcoin";
  if (method === "usdt_trc20") return "USDT (TRC20)";
  if (method === "usdt_erc20") return "USDT (ERC20)";
  return method;
}

function buildAdminTelegramAlert(
  payment: { method: string; amountUsd: number; id: string },
  userEmail: string,
  txHash: string | undefined,
): string {
  const hashNote = txHash ? "" : " (no txid provided \u2014 check the wallet address manually)";
  return `\u26A0\uFE0F Payment awaiting review: ${methodLabel(payment.method)} for ${userEmail}, $${payment.amountUsd}${hashNote}. Check /admin101/payments.`;
}

async function sendPendingEmail(opts: {
  userId: string;
  to: string;
  amountUsd: number;
  method: string;
}): Promise<void> {
  const channel = "email" as const;
  const recipient = opts.to;
  try {
    await sendEmail({
      to: opts.to,
      subject: "Your Vantra payment is pending confirmation",
      html: walletPendingHtml(opts.amountUsd, methodLabel(opts.method)),
    });
    await logNotification({
      userId: opts.userId,
      eventType: "payment_pending",
      channel,
      recipient,
      outcome: "sent",
    });
  } catch (err) {
    console.error("Pending-confirmation email failed:", err);
    await logApiError({
      route: "/api/billing/manual/submit",
      method: "POST",
      statusCode: 500,
      error: err,
      userId: opts.userId,
      clientReceivedSuccess: true, // the submission itself already succeeded — only this confirmation email failed
    });
    await logNotification({
      userId: opts.userId,
      eventType: "payment_pending",
      channel,
      recipient,
      outcome: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

function mapOutcome(result: CryptoVerifyResult): string {
  if (result.ok) return "confirmed_present";
  return result.reason ?? "not_found";
}