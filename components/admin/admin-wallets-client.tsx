"use client";

import { useState } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export function AdminWalletsClient({
  initial,
}: {
  initial: { btcAddress: string | null; usdtTrc20Address: string | null };
}) {
  const toast = useToast();
  // The page is force-dynamic and re-rendered server-side, so initializing from
  // props (fresh each load) is sufficient — no effect needed.
  const [btc, setBtc] = useState(initial.btcAddress ?? "");
  const [usdt, setUsdt] = useState(initial.usdtTrc20Address ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function save() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/wallets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ btcAddress: btc, usdtTrc20Address: usdt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save wallet addresses.");
        return;
      }
      setDirty(false);
      toast.push("Wallet addresses saved.", "success");
    } catch {
      setError("Network error while saving wallet addresses.");
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

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={loading || !dirty}>
          {loading && <Spinner />} Save addresses
        </Button>
        {!dirty && (
          <span className="text-xs text-fg-muted">No unsaved changes.</span>
        )}
      </div>
    </div>
  );
}