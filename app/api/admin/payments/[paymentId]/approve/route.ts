import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { extendPremium } from "@/lib/premium";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/**
 * Manually approves a "flagged" manual crypto payment: marks it paid +
 * manually_approved (no backdating — premium extends from max(now, current))
 * and records the review. Self-guarded — every admin API route calls
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
    parsed = reviewSchema.parse(await request.json().catch(() => ({})));
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { paymentId } = await params;
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  if (payment.status === "paid") {
    return NextResponse.json(
      { error: "This payment is already completed." },
      { status: 400 },
    );
  }

  // No backdating — extend from max(now, current) at approval time.
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "paid",
        verificationStatus: "manually_approved",
        reviewedAt: new Date(),
        reviewNote: parsed.note ?? null,
      },
    });
    await extendPremium(payment.userId, tx);
  });

  return NextResponse.json({ ok: true });
}