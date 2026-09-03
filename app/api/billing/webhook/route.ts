import { NextResponse } from "next/server";

import { verifyWebhookSignature } from "@/lib/billing";
import { db } from "@/lib/db";
import { extendPremium } from "@/lib/premium";

export const dynamic = "force-dynamic";

/**
 * OpenNode POSTs to callback_url after a charge changes state. NO authentication
 * gate here — this is called directly by OpenNode's servers; the only proof of
 * origin is verifyWebhookSignature().
 *
 * ⚠️ Body encoding (JSON vs form-urlencoded) is flagged UNCONFIRMED by the plan.
 * We read the raw body and accept BOTH (JSON first, then form-urlencoded
 * fallback), keyed off Content-Type — but this must be validated against a real
 * OpenNode delivery before it's trusted in production. Do NOT finalize this
 * handler purely from docs.
 */

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw) return {};
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    }
    // Default / application/json
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Last resort: OpenNode may deliver form-encoded without a proper header.
    try {
      const params = new URLSearchParams(raw);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      if (Object.keys(obj).length) return obj;
    } catch {
      /* fall through */
    }
    return {};
  }
}

export async function POST(request: Request) {
  const body = await parseBody(request);

  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const hashedOrder =
    typeof body.hashed_order === "string" ? body.hashed_order : "";

  const verified = verifyWebhookSignature({
    id,
    status,
    order_id: orderId,
    hashed_order: hashedOrder,
  });
  if (!id || !hashedOrder || !verified) {
    // Acknowledge with 200 so OpenNode stops retrying, but don't process.
    return NextResponse.json(
      { ok: false, reason: "invalid signature" },
      { status: 200 },
    );
  }

  if (status !== "paid") {
    // Not a payment-complete event (pending/underpaid/etc.) — nothing to extend.
    return NextResponse.json({ ok: true, ignored: status }, { status: 200 });
  }

  // Find the Payment ledger row: by charge id, else by our order_id.
  const payment = await db.payment.findFirst({
    where: {
      OR: [{ openNodeChargeId: id }, { id: orderId }],
    },
  });
  if (!payment) {
    // Unknown charge — acknowledge (200) so OpenNode stops retrying; there's
    // nothing we can act on without a matching local Payment row.
    return NextResponse.json(
      { ok: true, reason: "no matching payment" },
      { status: 200 },
    );
  }

  // Idempotency: already marked paid for this charge — safe to ack again.
  if (payment.status === "paid") {
    return NextResponse.json(
      { ok: true, ignored: "already_paid" },
      { status: 200 },
    );
  }

  const user = await db.user.findUnique({ where: { id: payment.userId } });
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "user missing" },
      { status: 200 },
    );
  }

  // Extend premium from max(now, current expiry) so early renewals stack
  // rather than reset (see lib/premium.ts). Both writes stay in a single
  // transaction so the payment can't flip to paid without the premium grant.
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "paid" },
    });
    await extendPremium(user.id, tx);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
