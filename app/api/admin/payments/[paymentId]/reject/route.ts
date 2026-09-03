import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/**
 * Rejects a "flagged" manual crypto payment (no premium grant) and records the
 * review. Self-guarded — every admin API route calls requireAdminSession().
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

  await db.payment.update({
    where: { id: payment.id },
    data: {
      verificationStatus: "rejected",
      reviewedAt: new Date(),
      reviewNote: parsed.note ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}