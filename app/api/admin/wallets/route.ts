import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import {
  getPremiumPricing,
  getWalletAddresses,
  setPremiumPricing,
  setWalletAddresses,
} from "@/lib/wallet-settings";

export const dynamic = "force-dynamic";

const walletSchema = z.object({
  btcAddress: z
    .string()
    .trim()
    .max(100, "Bitcoin address is too long")
    .optional()
    .nullable(),
  usdtTrc20Address: z
    .string()
    .trim()
    .max(100, "USDT-TRC20 address is too long")
    .optional()
    .nullable(),
  // Premium pricing, in whole US dollars (converted to cents below) — was
  // hardcoded ACTIVATE_PREMIUM_CENTS/RENEW_PREMIUM_CENTS, now admin-editable.
  activatePremiumUsd: z
    .number()
    .positive("Activation price must be greater than 0")
    .max(10_000, "That's an unusually high activation price — double check it")
    .optional(),
  renewPremiumUsd: z
    .number()
    .positive("Renewal price must be greater than 0")
    .max(10_000, "That's an unusually high renewal price — double check it")
    .optional(),
});

/**
 * Reads the configured wallet addresses + Premium pricing. Self-guarded —
 * every admin API route (except login) calls requireAdminSession().
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const [wallets, pricing] = await Promise.all([getWalletAddresses(), getPremiumPricing()]);
  return NextResponse.json({
    ...wallets,
    activatePremiumUsd: pricing.activatePremiumCents / 100,
    renewPremiumUsd: pricing.renewPremiumCents / 100,
  });
}

/**
 * Updates the configured wallet addresses (partial PATCH; empty string clears).
 * Self-guarded — every admin API route (except login) calls requireAdminSession().
 */
export async function PATCH(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = walletSchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const btcAddress = parsed.btcAddress && parsed.btcAddress.trim() ? parsed.btcAddress.trim() : null;
  const usdtTrc20Address =
    parsed.usdtTrc20Address && parsed.usdtTrc20Address.trim()
      ? parsed.usdtTrc20Address.trim()
      : null;

  // Wallet addresses and pricing are independent halves of this one PATCH —
  // only touch whichever half the caller actually sent something for.
  const hasWalletUpdate = parsed.btcAddress !== undefined || parsed.usdtTrc20Address !== undefined;
  const hasPricingUpdate =
    parsed.activatePremiumUsd !== undefined || parsed.renewPremiumUsd !== undefined;

  const [wallets, pricing] = await Promise.all([
    hasWalletUpdate
      ? setWalletAddresses({
          ...(parsed.btcAddress !== undefined ? { btcAddress } : {}),
          ...(parsed.usdtTrc20Address !== undefined ? { usdtTrc20Address } : {}),
        })
      : getWalletAddresses(),
    hasPricingUpdate
      ? setPremiumPricing({
          ...(parsed.activatePremiumUsd !== undefined
            ? { activatePremiumCents: Math.round(parsed.activatePremiumUsd * 100) }
            : {}),
          ...(parsed.renewPremiumUsd !== undefined
            ? { renewPremiumCents: Math.round(parsed.renewPremiumUsd * 100) }
            : {}),
        })
      : getPremiumPricing(),
  ]);

  return NextResponse.json({
    ...wallets,
    activatePremiumUsd: pricing.activatePremiumCents / 100,
    renewPremiumUsd: pricing.renewPremiumCents / 100,
  });
}