import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { billingConfigured } from "@/lib/billing";
import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { getWalletAddresses } from "@/lib/wallet-settings";

import { BillingCard } from "@/components/billing-card";
import { SettingsForm } from "@/components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

const PENDING_FRESH_MS = 2 * 60 * 60 * 1000; // same freshness window as the quote

// Module-level helper keeps Date.now() out of the component render body (the
// lint rule flags impure calls during render).
async function findPendingCryptoPayment(userId: string) {
  return db.payment.findFirst({
    where: {
      userId,
      method: { in: ["btc", "usdt_trc20"] },
      status: "pending",
      createdAt: { gte: new Date(Date.now() - PENDING_FRESH_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const user = await getCurrentUser();
  // Parent dashboard layout already gates auth/verify/onboarding; re-check for
  // type-safety so we never render with a null user.
  if (!user) redirect("/login");

  // The billing card and org-name field reflect the ACTIVE org's subscription.
  const org = await getActiveOrganization(user);

  const { upgraded } = await searchParams;

  const [wallets, pendingCryptoPayment] = await Promise.all([
    getWalletAddresses(),
    findPendingCryptoPayment(user.id),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-fg">Settings</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Manage your organization, plan and preferences.
      </p>
      {upgraded && (
        <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Payment successful — your Premium upgrade is being processed and will
          activate shortly.
        </div>
      )}
      <div className="mt-6 space-y-6">
        <BillingCard
          plan={org?.plan ?? "free"}
          premiumExpiresAt={org?.premiumExpiresAt?.toISOString() ?? null}
          openNodeConfigured={billingConfigured()}
          walletAddresses={wallets}
          pendingCryptoPayment={
            pendingCryptoPayment
              ? {
                  paymentId: pendingCryptoPayment.id,
                  method: pendingCryptoPayment.method as "btc" | "usdt_trc20",
                  walletAddress: pendingCryptoPayment.walletAddress ?? null,
                  expectedAmountCrypto: pendingCryptoPayment.expectedAmountCrypto,
                  expectedAmountUsd: pendingCryptoPayment.amountUsd,
                  priceAtOrderUsd: pendingCryptoPayment.priceAtOrderUsd,
                }
              : null
          }
        />
        <SettingsForm
          initialOrgName={org?.name || ""}
          email={user.email}
          initialNotifyDeviceOffline={user.notifyDeviceOffline}
          initialNotifyTicketReply={user.notifyTicketReply}
          initialTelegramChatId={user.telegramChatId}
        />
      </div>
    </div>
  );
}