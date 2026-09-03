import type { Metadata } from "next";

import { AdminWalletsClient } from "@/components/admin/admin-wallets-client";
import { getWalletAddresses } from "@/lib/wallet-settings";

export const metadata: Metadata = { title: "Admin · Wallets" };

export const dynamic = "force-dynamic";

export default async function AdminWalletsPage() {
  const wallets = await getWalletAddresses();
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Wallet addresses</h1>
      <p className="mt-1 text-sm text-fg-muted">
        The static addresses customers are told to send crypto to for manual
        payments.
      </p>
      <div className="mt-6">
        <AdminWalletsClient initial={wallets} />
      </div>
    </div>
  );
}