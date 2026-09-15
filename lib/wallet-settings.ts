import "server-only";

import { db } from "./db";

const SINGLETON_ID = "singleton";

export interface WalletAddresses {
  btcAddress: string | null;
  usdtTrc20Address: string | null;
}

export interface PremiumPricing {
  activatePremiumCents: number;
  renewPremiumCents: number;
}

/**
 * Reads the admin-configured static wallet addresses from the singleton
 * AdminSetting row. Returns nulls when nothing is configured yet.
 */
export async function getWalletAddresses(): Promise<WalletAddresses> {
  const row = await db.adminSetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    btcAddress: row?.btcAddress ?? null,
    usdtTrc20Address: row?.usdtTrc20Address ?? null,
  };
}

/**
 * Upserts the singleton AdminSetting row with the given wallet addresses
 * (undefined leaves an existing value untouched so a PATCH can update one at a
 * time). Throws if both are left undefined — every call should set at least one.
 */
export async function setWalletAddresses(input: {
  btcAddress?: string | null;
  usdtTrc20Address?: string | null;
}): Promise<WalletAddresses> {
  if (input.btcAddress === undefined && input.usdtTrc20Address === undefined) {
    throw new Error("setWalletAddresses called with no address to set.");
  }
  const row = await db.adminSetting.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      btcAddress: input.btcAddress ?? null,
      usdtTrc20Address: input.usdtTrc20Address ?? null,
    },
    update: {
      ...(input.btcAddress !== undefined ? { btcAddress: input.btcAddress } : {}),
      ...(input.usdtTrc20Address !== undefined
        ? { usdtTrc20Address: input.usdtTrc20Address }
        : {}),
    },
  });
  return { btcAddress: row.btcAddress ?? null, usdtTrc20Address: row.usdtTrc20Address ?? null };
}

// Defaults mirror AdminSetting's own @default — kept here explicitly because
// findUnique (unlike upsert) never creates the row, so a genuinely fresh
// install with no row yet must still report the same $100 / $20 the schema
// defaults to once a row does exist.
const DEFAULT_ACTIVATE_PREMIUM_CENTS = 10_000;
const DEFAULT_RENEW_PREMIUM_CENTS = 2_000;

/**
 * Reads the admin-configured Premium activate/renew prices (in US cents) from
 * the singleton AdminSetting row. Was hardcoded as ACTIVATE_PREMIUM_CENTS /
 * RENEW_PREMIUM_CENTS in the activate/renew-premium routes — now admin-editable
 * at runtime, reflected immediately (no restart: this is a live DB read on
 * every call, not a cached or env-baked value).
 */
export async function getPremiumPricing(): Promise<PremiumPricing> {
  const row = await db.adminSetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    activatePremiumCents: row?.activatePremiumCents ?? DEFAULT_ACTIVATE_PREMIUM_CENTS,
    renewPremiumCents: row?.renewPremiumCents ?? DEFAULT_RENEW_PREMIUM_CENTS,
  };
}

/**
 * Upserts the singleton AdminSetting row with the given Premium prices
 * (undefined leaves an existing value untouched). Throws if both are left
 * undefined — every call should set at least one, same discipline as
 * setWalletAddresses.
 */
export async function setPremiumPricing(input: {
  activatePremiumCents?: number;
  renewPremiumCents?: number;
}): Promise<PremiumPricing> {
  if (input.activatePremiumCents === undefined && input.renewPremiumCents === undefined) {
    throw new Error("setPremiumPricing called with no price to set.");
  }
  const row = await db.adminSetting.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activatePremiumCents: input.activatePremiumCents ?? DEFAULT_ACTIVATE_PREMIUM_CENTS,
      renewPremiumCents: input.renewPremiumCents ?? DEFAULT_RENEW_PREMIUM_CENTS,
    },
    update: {
      ...(input.activatePremiumCents !== undefined
        ? { activatePremiumCents: input.activatePremiumCents }
        : {}),
      ...(input.renewPremiumCents !== undefined ? { renewPremiumCents: input.renewPremiumCents } : {}),
    },
  });
  return {
    activatePremiumCents: row.activatePremiumCents,
    renewPremiumCents: row.renewPremiumCents,
  };
}