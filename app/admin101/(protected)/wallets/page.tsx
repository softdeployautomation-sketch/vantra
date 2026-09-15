import type { Metadata } from "next";

import { AdminWalletsClient } from "@/components/admin/admin-wallets-client";
import { getPremiumPricing, getWalletAddresses } from "@/lib/wallet-settings";

export const metadata: Metadata = { title: "Admin · Wallets & Pricing" };

export const dynamic = "force-dynamic";

export default async function AdminWalletsPage() {
  const [wallets, pricing] = await Promise.all([getWalletAddresses(), getPremiumPricing()]);
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Wallets &amp; Pricing</h1>
      <p className="mt-1 text-sm text-fg-muted">
        The static addresses customers are told to send crypto to for manual
        payments, and what Premium costs to activate/renew.
      </p>
      <div className="mt-6">
        <AdminWalletsClient
          initial={{
            ...wallets,
            activatePremiumUsd: pricing.activatePremiumCents / 100,
            renewPremiumUsd: pricing.renewPremiumCents / 100,
          }}
        />
      </div>
    </div>
  );
}