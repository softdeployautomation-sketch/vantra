import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin-auth";
import { getWalletAddresses, setWalletAddresses } from "@/lib/wallet-settings";

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
});

/**
 * Reads the configured wallet addresses. Self-guarded — every admin API route
 * (except login) calls requireAdminSession().
 */
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const wallets = await getWalletAddresses();
  return NextResponse.json(wallets);
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

  const updated = await setWalletAddresses({
    ...(parsed.btcAddress !== undefined ? { btcAddress } : {}),
    ...(parsed.usdtTrc20Address !== undefined ? { usdtTrc20Address } : {}),
  });
  return NextResponse.json(updated);
}