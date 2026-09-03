import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { sendEmail, walletCreditedHtml } from "@/lib/email";
import { logNotification } from "@/lib/notification-log";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  // The admin's final amount (in cents) credited to the wallet. Pre-filled
  // client-side from actualAmountUsd but editable. Capped at the same $5k
  // ceiling as a top-up.
  amountUsdCents: z
    .number()
    .int("Amount must be a whole number of cents")
    .min(1, "Amount must be at least $0.01")
    .max(5_000 * 100, "Amount can't exceed $5,000"),
});

/**
 * Admin confirms a pending_review manual crypto top-up: credits the customer's
 * wallet balance with the (possibly edited) amount and emails them. Never
 * auto-grants premium — the customer spends the credited balance later via
 * Activate/Renew. Self-guarded via requireAdminSession().
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = confirmSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { paymentId } = await params;
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  if (payment.verificationStatus !== "pending_review") {
    return NextResponse.json(
      { error: "This payment isn't awaiting review." },
      { status: 400 },
    );
  }

  const amountUsd = parsed.amountUsdCents / 100;

  // The where-clause's verificationStatus guard is re-checked at the moment
  // this transaction actually runs (not just via the findUnique above), so two
  // concurrent confirm clicks on the same payment (a double-click, or two
  // admin sessions) can't both pass and double-credit the wallet — only the
  // first to commit sees count === 1 and proceeds to credit.
  const confirmed = await db.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, verificationStatus: "pending_review" },
      data: {
        status: "paid",
        verificationStatus: "manually_approved",
        reviewedAt: new Date(),
        reviewNote: `Credited $${amountUsd.toFixed(2)}`,
      },
    });
    if (count === 0) return false;
    await tx.user.update({
      where: { id: payment.userId },
      data: { walletBalanceCents: { increment: parsed.amountUsdCents } },
    });
    return true;
  });

  if (!confirmed) {
    return NextResponse.json(
      { error: "This payment isn't awaiting review." },
      { status: 400 },
    );
  }

  // Email the customer that their wallet was credited with this exact amount.
  try {
    await sendEmail({
      to: payment.user.email,
      subject: "Your Vantra wallet has been credited",
      html: walletCreditedHtml(amountUsd),
    });
    await logNotification({
      userId: payment.userId,
      eventType: "payment_confirmed",
      channel: "email",
      recipient: payment.user.email,
      outcome: "sent",
    });
  } catch (err) {
    console.error("Payment-confirmed email failed:", err);
    await logNotification({
      userId: payment.userId,
      eventType: "payment_confirmed",
      channel: "email",
      recipient: payment.user.email,
      outcome: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true });
}