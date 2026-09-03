import "server-only";

import { db } from "./db";

const SINGLETON_ID = "singleton";

export interface WalletAddresses {
  btcAddress: string | null;
  usdtTrc20Address: string | null;
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