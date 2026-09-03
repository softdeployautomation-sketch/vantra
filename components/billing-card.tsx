"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useState } from "react";

import {
  BillingCryptoPanel,
  type CryptoQuote,
} from "@/components/billing-crypto-panel";
import { Button, Card, Input, Spinner } from "@/components/ui";
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

const ACTIVATE_CENTS = 10_000; // $100
const RENEW_CENTS = 2_000; // $20
const MAX_TOP_UP_USD = 5000;

export interface OrgBillingOption {
  id: string;
  name: string;
  plan: string;
  premiumExpiresAt: string | null;
}

export interface BillingCardProps {
  // Wallet balance is SHARED across all the user's orgs — render it once, not per-org.

  walletBalanceCents: number;
  orgs: OrgBillingOption[];

  walletAddresses: { btcAddress: string | null; usdtTrc20Address: string | null };
  pendingCryptoPayment: CryptoQuote | null;
}

export function BillingCard({
  walletBalanceCents,
  orgs,
  walletAddresses,
  pendingCryptoPayment,
}: BillingCardProps) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<string>("");
  // Active crypto quote shown in the panel; seeded from any resume-able pending
  // payment the server found, so a page refresh resumes an in-flight payment.

  const [quote, setQuote] = useState<CryptoQuote | null>(pendingCryptoPayment);
  const [actingOrgId, setActingOrgId] = useState<string | null>(null);

  const walletBalanceUsd = walletBalanceCents / 100;
  const hasBtc = !!walletAddresses.btcAddress;

  async function startCryptoQuote(method: "btc" | "usdt_trc20") {
    setError(null);
    const rawAmount = Number(topUpAmount);
    const parsedAmount = Math.round(rawAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || parsedAmount > MAX_TOP_UP_USD) {

      setError(`Enter a top-up amount between $1 and $${MAX_TOP_UP_USD}.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, amountUsd: parsedAmount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't quote a crypto payment right now. Please try again.");
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

  async function spendOrg(orgId: string, kind: "activate" | "renew") {
    const needed = kind === "activate" ? ACTIVATE_CENTS : RENEW_CENTS;

    if (walletBalanceCents < needed) {
      const missing = (needed - walletBalanceCents) / 100;
      toast.push(`Add $${missing.toFixed(2)} more to ${kind === "activate" ? "activate" : "renew"}.`, "error");
      return;
    }
    setActingOrgId(orgId);
    try {
      const res = await fetch(`/api/organizations/${orgId}/${kind === "activate" ? "activate-premium" : "renew-premium"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.push(data.error ?? `Couldn't ${kind} Premium.`, "error"); return; }
      toast.push(`Premium ${kind === "activate" ? "activated" : "renewed"} — $${(needed / 100).toFixed(2)} deducted from wallet.`, "success");
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setActingOrgId(null);
    }
  }

  const hasUsdt = !!walletAddresses.usdtTrc20Address;

  return (
    <Card className="p-6">
      <div>
        <h2 className="text-base font-semibold text-fg">Billing &amp; Wallet</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Add credit to your shared wallet, then activate or renew Premium for each organization.
        </p>
      </div>

      {error && !quote && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Wallet balance — shared across all orgs, rendered once */}
      <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-fg-muted">Wallet balance</p>
            <p className="text-2xl font-bold text-fg">${walletBalanceUsd.toFixed(2)}</p>
          </div>
          <p className="max-w-[180px] text-right text-xs text-fg-muted">
            Shared across all your organizations.
          </p>
        </div>
      </div>

      {quote && (
        <div className="mt-4">
          <BillingCryptoPanel quote={quote} onDone={closeQuote} />
        </div>
      )}

      {!quote && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-semibold text-fg">Top up wallet</p>
          <p className="mt-1 text-xs text-fg-muted">
            Add credit with Bitcoin or USDT (TRC20). We&apos;ll review your payment and
            credit your wallet once confirmed.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                Amount (USD)
              </label>
              <Input
                type="number"
                min="1"
                max="5000"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="e.g. 150"
              />
            </div>
            {hasBtc && (
              <Button
                variant="secondary"
                disabled={loading}
                onClick={() => startCryptoQuote("btc")}
              >
                {loading && <Spinner />} Top up with BTC
              </Button>
            )}
            {hasUsdt && (
              <Button
                variant="secondary"
                disabled={loading}
                onClick={() => startCryptoQuote("usdt_trc20")}
              >
                {loading && <Spinner />} Top up with USDT
              </Button>
            )}
          </div>
          {!hasBtc && !hasUsdt && (
            <p className="mt-2 text-xs text-fg-muted">
              No wallet is configured yet — crypto top-ups aren&apos;t available right now.
            </p>
          )}
        </div>
      )}

      {!quote && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-semibold text-fg">Premium</p>
          <p className="mt-1 text-xs text-fg-muted">
            Activate ($100) or renew ($20) per organization, deducted from your wallet.
          </p>
          <div className="mt-3 space-y-2">
            {orgs.map((org) => {
              const isPremiumOrg = org.plan === "premium";
              const exp = org.premiumExpiresAt ? new Date(org.premiumExpiresAt) : null;
              const daysLeft =
                exp && exp.getTime() > now
                  ? Math.max(0, Math.ceil((exp.getTime() - now) / (24 * 60 * 60 * 1000)))
                  : null;
              const canActivate = walletBalanceCents >= ACTIVATE_CENTS;
              const canRenew = walletBalanceCents >= RENEW_CENTS;
              const missingActivate = (ACTIVATE_CENTS - walletBalanceCents) / 100;
              const missingRenew = (RENEW_CENTS - walletBalanceCents) / 100;
              const busy = actingOrgId === org.id;

              return (
                <div
                  key={org.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{org.name}</p>
                    <p className="text-xs text-fg-muted">
                      {isPremiumOrg
                        ? daysLeft !== null
                          ? `Premium · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
                          : "Premium"
                        : "Free"}
                    </p>
                    {isPremiumOrg
                      ? !canRenew && (
                          <p className="text-xs text-amber-600">
                            Add ${missingRenew.toFixed(2)} more to renew.
                          </p>
                        )
                      : !canActivate && (
                          <p className="text-xs text-amber-600">
                            Add ${missingActivate.toFixed(2)} more to activate.
                          </p>
                        )}
                  </div>
                  {isPremiumOrg ? (
                    <Button
                      variant="secondary"
                      disabled={busy || !canRenew}
                      onClick={() => spendOrg(org.id, "renew")}
                    >
                      {busy && <Spinner />} Renew ($20)
                    </Button>
                  ) : (
                    <Button
                      disabled={busy || !canActivate}
                      onClick={() => spendOrg(org.id, "activate")}
                    >
                      {busy && <Spinner />} Activate Premium ($100)
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}