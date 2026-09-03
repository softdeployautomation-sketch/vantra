import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "pending",
  "paid",
  "underpaid",
  "expired",
  "refunded",
] as const;

/**
 * Lists Payment rows for the admin Payments page, optionally filtered by
 * status. Self-guarded — every admin API route (except login) calls
 * requireAdminSession().
 */
export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: "Invalid status filter." },
      { status: 400 },
    );
  }

  const payments = await db.payment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, orgName: true } } },
  });

  return NextResponse.json(
    payments.map((p) => ({
      id: p.id,
      userId: p.userId,
      userEmail: p.user.email,
      userOrg: p.user.orgName,
      method: p.method,
      amountUsd: p.amountUsd,
      kind: p.kind,
      status: p.status,
      verificationStatus: p.verificationStatus,
      walletAddress: p.walletAddress,
      priceAtOrderUsd: p.priceAtOrderUsd,
      expectedAmountCrypto: p.expectedAmountCrypto,
      txHash: p.txHash,
      actualAmountUsd: p.actualAmountUsd,
      confirmations: p.confirmations,
      openNodeChargeId: p.openNodeChargeId,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      reviewNote: p.reviewNote,
      createdAt: p.createdAt.toISOString(),
    })),
  );
}