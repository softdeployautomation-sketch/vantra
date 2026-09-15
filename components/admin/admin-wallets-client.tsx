"use client";

import { useState } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export function AdminWalletsClient({
  initial,
}: {
  initial: {
    btcAddress: string | null;
    usdtTrc20Address: string | null;
    usdtErc20Address: string | null;
    activatePremiumUsd: number;
    renewPremiumUsd: number;
  };
}) {
  const toast = useToast();
  // The page is force-dynamic and re-rendered server-side, so initializing from
  // props (fresh each load) is sufficient — no effect needed.
  const [btc, setBtc] = useState(initial.btcAddress ?? "");
  const [usdt, setUsdt] = useState(initial.usdtTrc20Address ?? "");
  const [usdtErc20, setUsdtErc20] = useState(initial.usdtErc20Address ?? "");
  const [activateUsd, setActivateUsd] = useState(String(initial.activatePremiumUsd));
  const [renewUsd, setRenewUsd] = useState(String(initial.renewPremiumUsd));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);

  async function save() {
    setError(null);
    if (pricingDirty) {
      const activateNum = Number(activateUsd);
      const renewNum = Number(renewUsd);
      if (!Number.isFinite(activateNum) || activateNum <= 0) {
        setError("Activation price must be greater than 0");
        return;
      }
      if (!Number.isFinite(renewNum) || renewNum <= 0) {
        setError("Renewal price must be greater than 0");
        return;
      }
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/wallets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          btcAddress: btc,
          usdtTrc20Address: usdt,
          usdtErc20Address: usdtErc20,
          ...(pricingDirty
            ? { activatePremiumUsd: Number(activateUsd), renewPremiumUsd: Number(renewUsd) }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save settings.");
        return;
      }
      setDirty(false);
      setPricingDirty(false);
      toast.push("Settings saved — takes effect immediately, no restart needed.", "success");
    } catch {
      setError("Network error while saving settings.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Bitcoin (BTC)</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Customers are told to send to this Bitcoin mainnet address.
        </p>
        <div className="mt-4">
          <Label htmlFor="btcAddress">BTC address</Label>
          <Input
            id="btcAddress"
            value={btc}
            onChange={(e) => {
              setBtc(e.target.value);
              setDirty(true);
            }}
            placeholder="bc1…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">USDT (TRC20)</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Customers are told to send USDT on the Tron TRC20 network. Only the
          USDT-TRC20 contract is accepted.
        </p>
        <div className="mt-4">
          <Label htmlFor="usdtAddress">USDT-TRC20 address</Label>
          <Input
            id="usdtAddress"
            value={usdt}
            onChange={(e) => {
              setUsdt(e.target.value);
              setDirty(true);
            }}
            placeholder="T…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">USDT (ERC20)</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Customers are told to send USDT on the Ethereum ERC20 network. No automated
          on-chain verification yet for this chain — ERC20 payments always go to manual
          review. Leave blank and the option won&apos;t show at checkout.
        </p>
        <div className="mt-4">
          <Label htmlFor="usdtErc20Address">USDT-ERC20 address</Label>
          <Input
            id="usdtErc20Address"
            value={usdtErc20}
            onChange={(e) => {
              setUsdtErc20(e.target.value);
              setDirty(true);
            }}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Premium pricing</h2>
        <p className="mt-1 text-xs text-fg-muted">
          What customers pay from their wallet to activate or renew Premium on an organization.
          Takes effect immediately — no restart needed.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="activatePrice">Activation price (USD) — first 30 days</Label>
            <Input
              id="activatePrice"
              type="number"
              min="0.01"
              step="0.01"
              value={activateUsd}
              onChange={(e) => {
                setActivateUsd(e.target.value);
                setPricingDirty(true);
              }}
              placeholder="100"
            />
          </div>
          <div>
            <Label htmlFor="renewPrice">Renewal price (USD) — per 30 days</Label>
            <Input
              id="renewPrice"
              type="number"
              min="0.01"
              step="0.01"
              value={renewUsd}
              onChange={(e) => {
                setRenewUsd(e.target.value);
                setPricingDirty(true);
              }}
              placeholder="20"
            />
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={loading || (!dirty && !pricingDirty)}>
          {loading && <Spinner />} Save
        </Button>
        {!dirty && !pricingDirty && (
          <span className="text-xs text-fg-muted">No unsaved changes.</span>
        )}
      </div>
    </div>
  );
}