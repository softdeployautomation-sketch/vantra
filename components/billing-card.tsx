"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useState } from "react";

import {
  BillingCryptoPanel,
  type CryptoQuote,
} from "@/components/billing-crypto-panel";
import { Button, Card, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

// The one subscription is just "time passing" — subscribe once and return a new
// timestamp to React each second (the canonical pattern for a live clock, which
// keeps Date.now() out of render to satisfy the react purity rule).
const subscribeToTime = () => {
  const id = setInterval(() => {}, 1000);
  return () => clearInterval(id);
};
const getNow = () => Date.now();

function useNow(): number {
  return useSyncExternalStore(subscribeToTime, getNow, getNow);
}

export interface BillingCardProps {
  plan: string;
  premiumExpiresAt: string | null;
  openNodeConfigured: boolean;
  walletAddresses: { btcAddress: string | null; usdtTrc20Address: string | null };
  pendingCryptoPayment: CryptoQuote | null;
}

export function BillingCard({
  plan,
  premiumExpiresAt,
  openNodeConfigured,
  walletAddresses,
  pendingCryptoPayment,
}: BillingCardProps) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Active crypto quote shown in the panel; seeded from any resume-able pending
  // payment the server found, so a page refresh resumes an in-flight payment.
  const [quote, setQuote] = useState<CryptoQuote | null>(pendingCryptoPayment);

  const isPremium = plan === "premium";
  const expiresAt = premiumExpiresAt ? new Date(premiumExpiresAt) : null;

  const daysRemaining =
    expiresAt && expiresAt.getTime() > now
      ? Math.max(
          0,
          Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)),
        )
      : null;

  async function startOpenNodeCheckout() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "opennode" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ?? "Couldn't start checkout right now. Please try again.",
        );
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      toast.push("Checkout started.");
      router.refresh();
    } catch {
      setError("Network error while starting checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function startCryptoQuote(method: "btc" | "usdt_trc20") {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ?? "Couldn't quote a crypto payment right now. Please try again.",
        );
        return;
      }
      setQuote({
        paymentId: data.paymentId,
        method,
        walletAddress: data.walletAddress ?? null,
        expectedAmountCrypto: data.expectedAmountCrypto ?? null,
        expectedAmountUsd: data.expectedAmountUsd ?? null,
        priceAtOrderUsd: data.priceAtOrderUsd ?? null,
      });
    } catch {
      setError("Network error while quoting a crypto payment. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function closeQuote() {
    setQuote(null);
    setError(null);
  }

  const hasOpenNode = openNodeConfigured;
  const hasBtc = !!walletAddresses.btcAddress;
  const hasUsdt = !!walletAddresses.usdtTrc20Address;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Vantra Premium</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {isPremium
              ? "You're on the Premium plan. Remote Tools and a higher device cap are active."
              : "Unlock Remote Tools, more devices and priority support."}
          </p>
        </div>
        <BadgePremium isPremium={isPremium} />
      </div>

      {error && !quote && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {quote ? (
        <BillingCryptoPanel quote={quote} onDone={closeQuote} />
      ) : isPremium ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm text-fg">
            <span className="font-medium">Premium active until</span>{" "}
            {expiresAt ? expiresAt.toLocaleDateString() : "—"}.
            {daysRemaining !== null && daysRemaining <= 30 && daysRemaining > 0
              ? ` ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining.`
              : ""}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            If Premium lapses, your account quietly reverts to the free plan —
            nothing is locked or lost, you just lose Premium access.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {hasOpenNode && (
              <Button type="button" onClick={startOpenNodeCheckout} disabled={loading}>
                {loading && <Spinner />} Renew with card / Lightning
              </Button>
            )}
            {hasBtc && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => startCryptoQuote("btc")}
                disabled={loading}
              >
                Renew with Bitcoin
              </Button>
            )}
            {hasUsdt && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => startCryptoQuote("usdt_trc20")}
                disabled={loading}
              >
                Renew with USDT (TRC20)
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm text-fg">
            <span className="font-medium">$100</span> upfront · then{" "}
            <span className="font-medium">$29</span>/month
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Pay by card, Bitcoin, or USDT. Your card is never stored.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {hasOpenNode && (
              <Button type="button" onClick={startOpenNodeCheckout} disabled={loading}>
                {loading && <Spinner />} Upgrade — Pay with card
              </Button>
            )}
            {hasBtc && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => startCryptoQuote("btc")}
                disabled={loading}
              >
                Upgrade — Pay with Bitcoin
              </Button>
            )}
            {hasUsdt && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => startCryptoQuote("usdt_trc20")}
                disabled={loading}
              >
                Upgrade — Pay with USDT (TRC20)
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function BadgePremium({ isPremium }: { isPremium: boolean }) {
  if (isPremium) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        Premium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-white/10 dark:text-gray-300">
      Free
    </span>
  );
}