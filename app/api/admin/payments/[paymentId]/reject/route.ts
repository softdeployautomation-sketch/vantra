import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { sendEmail, walletRejectedHtml } from "@/lib/email";
import { logApiError } from "@/lib/api-error-log";
import { logNotification } from "@/lib/notification-log";

export const dynamic = "force-dynamic";

const rejectSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "A rejection message is required")
    .max(1000, "Message is too long"),
});

/**
 * Rejects a pending_review manual crypto top-up (no wallet credit). Requires a
 * message which is emailed to the customer verbatim. Self-guarded via
 * requireAdminSession().
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
    parsed = rejectSchema.parse(await request.json());
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

  // Guard re-checked at write time (not just via the findUnique above) so a
  // reject can't land after a concurrent confirm already credited the wallet
  // — that would leave the payment marked "rejected" while the customer keeps
  // the credit, an inconsistent state.
  const { count } = await db.payment.updateMany({
    where: { id: payment.id, verificationStatus: "pending_review" },
    data: {
      verificationStatus: "manually_rejected",
      status: "rejected",
      reviewedAt: new Date(),
      reviewNote: parsed.message,
    },
  });
  if (count === 0) {
    return NextResponse.json(
      { error: "This payment isn't awaiting review." },
      { status: 400 },
    );
  }

  // Email the customer the admin's exact message.
  try {
    await sendEmail({
      to: payment.user.email,
      subject: "Your Vantra payment could not be confirmed",
      html: walletRejectedHtml(parsed.message),
    });
    await logNotification({
      userId: payment.userId,
      eventType: "payment_rejected",
      channel: "email",
      recipient: payment.user.email,
      outcome: "sent",
    });
  } catch (err) {
    console.error("Payment-rejected email failed:", err);
    await logApiError({
      route: "/api/admin/payments/[paymentId]/reject",
      method: "POST",
      statusCode: 500,
      error: err,
    });
    await logNotification({
      userId: payment.userId,
      eventType: "payment_rejected",
      channel: "email",
      recipient: payment.user.email,
      outcome: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true });
}