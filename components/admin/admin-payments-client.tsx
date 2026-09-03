"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/toast";
import { Badge, Button, Select, Spinner, Td, Th } from "@/components/ui";

export interface AdminPayment {
  id: string;
  userEmail: string;
  userOrg: string | null;
  method: string;
  amountUsd: number;
  verificationStatus: string;
  expectedAmountCrypto: number | null;
  txHash: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["pending", "Pending"],
  ["paid", "Paid"],
  ["flagged", "Flagged"],
  ["rejected", "Rejected"],
];

export function AdminPaymentsClient({ payments }: { payments: AdminPayment[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [pendingReview, setPendingReview] = useState<string | null>(null);
  const currentStatus = searchParams.get("status") ?? "";

  async function review(paymentId: string, action: "approve" | "reject") {
    setPendingReview(paymentId);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? `Couldn't ${action} that payment.`, "error");
        return;
      }
      toast.push(`Payment ${action === "approve" ? "approved" : "rejected"}.`, "success");
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setPendingReview(null);
    }
  }

  const flaggedCount = payments.filter(
    (p) => p.verificationStatus === "flagged",
  ).length;

  return (
    <div>
      {flaggedCount > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {flaggedCount} payment{flaggedCount === 1 ? "" : "s"} awaiting review.
        </div>
      )}
      <Select
        value={currentStatus}
        onChange={(e) => {
          const v = e.target.value;
          const url = new URL(window.location.href);
          if (v) url.searchParams.set("status", v);
          else url.searchParams.delete("status");
          router.push(url.pathname + url.search);
          router.refresh();
        }}
        className="mb-4 max-w-xs"
      >
        {STATUS_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </Select>

      <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
        <table className="min-w-full divide-y divide-border text-left text-sm">
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Method</Th>
              <Th>Amount</Th>
              <Th>Verification</Th>
              <Th>Hash</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments.map((p) => {
              const isFlagged = p.verificationStatus === "flagged";
              return (
                <tr key={p.id}>
                  <Td>
                    <div className="font-medium text-fg">{p.userEmail}</div>
                    {p.userOrg && (
                      <div className="text-xs text-fg-muted">{p.userOrg}</div>
                    )}
                  </Td>
                  <Td>{methodLabel(p.method)}</Td>
                  <Td className="text-fg">
                    ${p.amountUsd}
                    <span className="block text-xs text-fg-muted">
                      {p.expectedAmountCrypto?.toFixed(6) ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <VerificationBadge status={p.verificationStatus} />
                  </Td>
                  <Td className="max-w-[160px] truncate text-fg-muted">
                    {p.txHash ?? "—"}
                  </Td>
                  <Td className="text-right">
                    {isFlagged ? (
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          className="px-2.5 py-1.5 text-xs"
                          disabled={pendingReview === p.id}
                          onClick={() => review(p.id, "approve")}
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          className="px-2.5 py-1.5 text-xs"
                          disabled={pendingReview === p.id}
                          onClick={() => review(p.id, "reject")}
                        >
                          {pendingReview === p.id && <Spinner />} Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
            {payments.length === 0 && (
              <tr>
                <Td colSpan={6} className="text-center text-fg-muted">
                  No payments match this filter.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
function methodLabel(method: string): string {
  if (method === "btc") return "BTC";
  if (method === "usdt_trc20") return "USDT (TRC20)";
  return "OpenNode";
}

function VerificationBadge({ status }: { status: string }) {
  const tone =
    status === "auto_approved" || status === "manually_approved"
      ? "success"
      : status === "rejected"
        ? "danger"
        : status === "flagged"
          ? "warning"
          : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
}