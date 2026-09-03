"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/toast";
import { Button, Input, Label, Spinner } from "@/components/ui";

export interface CryptoQuote {
  paymentId: string;
  method: "btc" | "usdt_trc20";
  walletAddress: string | null;
  expectedAmountCrypto: number | null;
  expectedAmountUsd: number | null;
  priceAtOrderUsd: number | null;
}

export function BillingCryptoPanel({
  quote,
  onDone,
}: {
  quote: CryptoQuote;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flaggedBanner, setFlaggedBanner] = useState(false);

  const isBtc = quote.method === "btc";
  const networkLabel = isBtc ? "Bitcoin mainnet" : "Tron TRC20 — USDT only";
  const amountLabel = isBtc ? "BTC" : "USDT";

  const amount = quote.expectedAmountCrypto ?? 0;
  const formattedAmount = amount.toLocaleString(undefined, {
    maximumFractionDigits: 8,
  });

  async function copyAddress() {
    if (!quote.walletAddress) return;
    try {
      await navigator.clipboard.writeText(quote.walletAddress);
      toast.push("Address copied to clipboard.", "success");
    } catch {
      toast.push("Couldn't copy the address — please copy it manually.", "error");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFlaggedBanner(false);
    setLoading(true);
    try {
      const res = await fetch("/api/billing/manual/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: quote.paymentId, txHash }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.verificationStatus === "auto_approved") {
        toast.push("Payment verified — Premium is active!", "success");
        router.refresh();
        onDone();
        return;
      }
      if (data.verificationStatus === "flagged") {
        setFlaggedBanner(true);
        return;
      }
      if (data.verificationStatus === "rejected") {
        setError(
          data.error ??
            "This transaction doesn't match your payment. Please check the address and try again.",
        );
        return;
      }
      // Any non-success (422 unconfirmed/not-found/fetch-error, 4xx validation).
      if (!res.ok) {
        setError(data.error ?? "Couldn't verify that transaction right now. Please try again.");
        return;
      }
      toast.push("Payment received.");
      router.refresh();
      onDone();
    } catch {
      setError("Network error while verifying. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-black/5 p-4 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">
          Pay {QuoteTitle(isBtc)} · {networkLabel}
        </p>
      </div>

      {/* Send-to address */}
      <div className="mt-3">
        <Label>Send to this address</Label>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg">
            {quote.walletAddress ?? "Not configured"}
          </code>
          <Button type="button" variant="secondary" onClick={copyAddress} className="shrink-0">
            Copy
          </Button>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Send exactly{" "}
          <span className="font-medium text-fg">
            {formattedAmount} {amountLabel}
          </span>{" "}
          for ${quote.expectedAmountUsd?.toFixed(2)}. Amounts within ±5% are
          auto-approved.
        </p>
      </div>

      {flaggedBanner && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Payment received, but the amount doesn&apos;t exactly match your quote. It&apos;s
          now pending a quick manual review — no action needed from you.
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit hash */}
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <Label htmlFor="txHash">
            Transaction hash after sending
          </Label>
          <Input
            id="txHash"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            placeholder={isBtc ? "Paste the txid…" : "Paste the TxID…"}
            required
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={loading || txHash.trim().length === 0}>
            {loading && <Spinner />}
            I&apos;ve sent it — verify
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function QuoteTitle(isBtc: boolean): string {
  return isBtc ? "with Bitcoin" : "with USDT (TRC20)";
}