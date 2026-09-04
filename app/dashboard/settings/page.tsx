import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";
import { getWalletAddresses } from "@/lib/wallet-settings";

import { BillingCard, type OrgBillingOption } from "@/components/billing-card";
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

  // The org-name field reflects the ACTIVE org; the billing card is shared-wallet
  // + per-org, so it needs the wallet balance and every org's subscription state.
  const org = await getActiveOrganization(user);

  const { upgraded } = await searchParams;

  const [wallets, pendingCryptoPayment, orgs] = await Promise.all([
    getWalletAddresses(),
    findPendingCryptoPayment(user.id),
    db.organization.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        plan: true,
        premiumExpiresAt: true,
      },
    }),
  ]);

  const billingOrgs: OrgBillingOption[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    plan: o.plan,
    premiumExpiresAt: o.premiumExpiresAt?.toISOString() ?? null,
  }));

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
        <div id="wallet" className="scroll-mt-20">
        <BillingCard
          walletBalanceCents={user.walletBalanceCents}
          orgs={billingOrgs}
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
        </div>
        <SettingsForm
          initialOrgName={org?.name || ""}
          email={user.email}
          initialNotifyDeviceOffline={user.notifyDeviceOffline}
          initialNotifyDeviceOnline={user.notifyDeviceOnline}
          initialNotifyTicketReply={user.notifyTicketReply}
          initialTelegramChatId={user.telegramChatId}
        />
      </div>
    </div>
  );
}