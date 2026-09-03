"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/toast";
import { Badge, Button, Input, Select, Spinner, Td, Th } from "@/components/ui";

export interface AdminPayment {
  id: string;
  userEmail: string;
  userOrg: string | null;
  method: string;
  amountUsd: number;
  verificationStatus: string;
  expectedAmountCrypto: number | null;
  actualAmountUsd: number | null;
  txHash: string | null;
  reviewNote: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["pending", "Pending"],
  ["pending_review", "Pending review"],
  ["paid", "Paid"],
  ["flagged", "Flagged"],
  ["rejected", "Rejected"],
];

export function AdminPaymentsClient({ payments }: { payments: AdminPayment[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const currentStatus = searchParams.get("status") ?? "";

  async function confirmPayment(payment: AdminPayment, amountUsdCents: number) {
    setBusyId(payment.id);
    try {
      const res = await fetch(`/api/admin/payments/${payment.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't confirm that payment.", "error");
        return;
      }
      toast.push("Payment confirmed — wallet credited.", "success");
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function rejectPayment(payment: AdminPayment, message: string) {
    setBusyId(payment.id);
    try {
      const res = await fetch(`/api/admin/payments/${payment.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't reject that payment.", "error");
        return;
      }
      toast.push("Payment rejected.", "success");
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = payments.filter(
    (p) => p.verificationStatus === "pending_review",
  ).length;

  return (
    <div>
      {pendingCount > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pendingCount} payment{pendingCount === 1 ? "" : "s"} awaiting review.
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
              const isPendingReview = p.verificationStatus === "pending_review";
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
                    {p.reviewNote && (
                      <span className="block max-w-[220px] text-xs text-fg-muted">
                        {p.reviewNote}
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-[160px] truncate text-fg-muted">{p.txHash ?? "—"}</Td>
                  <Td className="text-right">
                    {isPendingReview ? (
                      <ReviewRow
                        payment={p}
                        busy={busyId === p.id}
                        onConfirm={confirmPayment}
                        onReject={rejectPayment}
                      />
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
}

function ReviewRow({
  payment,
  busy,
  onConfirm,
  onReject,
}: {
  payment: AdminPayment;
  busy: boolean;
  onConfirm: (payment: AdminPayment, amountUsdCents: number) => void;
  onReject: (payment: AdminPayment, message: string) => void;
}) {
  const prefilledCents = Math.round((payment.actualAmountUsd ?? payment.amountUsd) * 100);
  const [amountUsd, setAmountUsd] = useState<string>((prefilledCents / 100).toFixed(2));
  const [message, setMessage] = useState<string>("");
  const cents = Math.round(parseFloat(amountUsd) * 100);
  const centsValid = Number.isFinite(cents) && cents > 0 && cents <= 500000;
  const messageTrim = message.trim();

  return (
    <div className="flex flex-col items-end gap-2 text-left">
      <div className="flex items-center gap-2">
        <label className="text-xs text-fg-muted">Received $</label>
        <Input
          type="number"
          min="0.01"
          max="5000"
          step="0.01"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          className="w-28 py-1 text-xs"
          disabled={busy}
        />
        <Button
          type="button"
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          disabled={busy || !centsValid}
          onClick={() => {
            if (centsValid) onConfirm(payment, cents);
          }}
        >
          {busy ? <Spinner className="h-3 w-3" /> : null} Confirm
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Rejection message (required)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-52 py-1 text-xs"
          disabled={busy}
        />
        <Button
          type="button"
          variant="danger"
          className="px-2.5 py-1.5 text-xs"
          disabled={busy || messageTrim.length === 0}
          onClick={() => onReject(payment, messageTrim)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function methodLabel(method: string): string {
  if (method === "btc") return "BTC";
  if (method === "usdt_trc20") return "USDT (TRC20)";
  return method;
}

function VerificationBadge({ status }: { status: string }) {
  // pending_review must NOT share "success" with the terminal approved states —
  // it's an awaiting-action row, not a completed one, and an admin scanning for
  // green-as-done would otherwise skip reviewing it.
  const tone =
    status === "auto_approved" || status === "manually_approved"
      ? "success"
      : status === "rejected" || status === "manually_rejected"
        ? "danger"
        : status === "flagged" || status === "pending_review"
          ? "warning"
          : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}