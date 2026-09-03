import type { Metadata } from "next";

import {
  AdminPaymentsClient,
  type AdminPayment,
} from "@/components/admin/admin-payments-client";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Admin · Payments" };

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  const allowedStatuses = ["pending", "paid", "flagged", "rejected"];
  const filter = status && allowedStatuses.includes(status) ? status : undefined;

  const payments = await db.payment.findMany({
    where: filter
      ? status === "flagged"
        ? { verificationStatus: "flagged" }
        : { status: filter }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, orgName: true } } },
  });

  const rows: AdminPayment[] = payments.map((p) => ({
    id: p.id,
    userEmail: p.user.email,
    userOrg: p.user.orgName,
    method: p.method,
    amountUsd: p.amountUsd,
    verificationStatus: p.verificationStatus,
    expectedAmountCrypto: p.expectedAmountCrypto,
    txHash: p.txHash,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Payments</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Review flagged payments and audit the ledger.
      </p>
      <div className="mt-6">
        <AdminPaymentsClient payments={rows} />
      </div>
    </div>
  );
}