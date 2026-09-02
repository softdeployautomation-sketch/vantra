import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

import { env } from "./env";

const OPENNODE_BASE = env.openNodeApiBaseUrl;
const KEY = env.openNodeApiKey;

/** True once the account is fully set up; billing endpoints are inert until then. */
export const billingConfigured = () => KEY.trim().length > 0;

function requireConfigured(): string {
  if (!billingConfigured()) {
    throw new Error(
      "OpenNode billing is not configured yet. Set OPENNODE_API_KEY (and OPENNODE_API_BASE_URL) in the environment.",
    );
  }
  return KEY;
}

export interface CreateChargeOpts {
  amountUsd: number;
  orderId: string;
  customerEmail: string;
}

export async function createCharge(opts: CreateChargeOpts) {
  const key = requireConfigured();
  const r = await fetch(`${OPENNODE_BASE}/charges`, {
    method: "POST",
    headers: {
      Authorization: key, // OpenNode's own scheme — no "Bearer " prefix
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: opts.amountUsd,
      currency: "USD",
      callback_url: `${env.appBaseUrl}/api/billing/webhook`,
      success_url: `${env.appBaseUrl}/dashboard/settings?upgraded=1`,
      order_id: opts.orderId,
      description: opts.amountUsd >= 100 ? "Vantra Premium (initial)" : "Vantra Premium (renewal)",
      customer_email: opts.customerEmail,
      auto_settle: false,
    }),
  });
  if (!r.ok) {
    throw new Error(`OpenNode ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  }
  return ((await r.json()) as {
    data: { id: string; status: string; hosted_checkout_url: string };
  }).data;
}

export interface OpenNodeWebhookPayload {
  id: string;
  status: string;
  order_id: string;
  hashed_order: string;
  [key: string]: unknown;
}

/**
 * Verifies an OpenNode webhook signature: HMAC-SHA256(key = api key, message = id)
 * compared against hashed_order in constant time.
 *
 * ⚠️ NOT YET FINALIZED — per plan this is flagged unconfirmed until verified against
 * a REAL OpenNode sandbox delivery. Two unknowns remain:
 *   1. hex vs base64 encoding of the expected HMAC (plan assumes hex — confirmed by
 *      OpenNode docs but not by a live delivery),
 *   2. webhook body encoding (JSON vs form-urlencoded) — handled in the route.
 * Do NOT trust this in production before that live round-trip passes.
 */
export function verifyWebhookSignature(payload: OpenNodeWebhookPayload): boolean {
  const key = KEY.trim();
  if (!key || !payload.id || !payload.hashed_order) return false;
  const expected = createHmac("sha256", key).update(payload.id).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(payload.hashed_order, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}