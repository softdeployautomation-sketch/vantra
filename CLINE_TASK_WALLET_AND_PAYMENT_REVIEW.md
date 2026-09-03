# Cline Task — Wallet Balance + Admin-Reviewed Manual Payments (replaces auto-approve)

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code + one migration. **Now unblocked** — the multi-org foundation (`Organization.plan`/`premiumExpiresAt`, `lib/premium.ts`'s `extendPremium(organizationId, tx?)`/`resolveActiveOrgId(userId, tx?)`) is live in production as of this task being written. This task spends against that foundation; don't start it if that hasn't landed.

## What already exists to build on — confirmed by reading the actual current code, not the older draft

- **`lib/premium.ts`** already takes an `organizationId` (not a user) and is transaction-aware — `extendPremium(organizationId, tx?)` and `resolveActiveOrgId(userId, tx?)` are both correct and unchanged by this task. Reuse them as-is.
- **`Payment`** (schema.prisma) is `userId`-scoped (correct, unchanged — the wallet balance is per-user, premium is spent per-org) and already has the full manual-crypto column set: `method`, `walletAddress`, `priceAtOrderUsd`, `expectedAmountCrypto`, `txHash` (unique), `actualAmountUsd`, `confirmations`, `verificationStatus`, `reviewedAt`, `reviewNote`, plus a `PaymentVerificationAttempt` relation. **`amountUsd` is currently fixed at "100 initial, 29 per monthly renewal"** (a plain `Int` with a two-value convention) — this needs to become a genuine free-entry amount, see below.
- **`lib/crypto-verify.ts`** (`verifyBtcPayment`, `verifyUsdtPayment`, `getLivePrices`, `CryptoVerifyResult`) is correct and unchanged — still the right way to check a hash on-chain. What changes is *what happens* with a conclusive result, not the verification itself.
- **`lib/telegram.ts`** (`sendTelegramMessage`, `notifyAdmin`, `telegramLinkUrl`, `telegramLinkConfigured`) and **`lib/email.ts`**'s `sendEmail` both exist and work — reuse both directly, don't rebuild either.
- **`app/api/billing/manual/submit/route.ts`** (current file, read it before touching it) has the *old* auto-approve-within-tolerance path: a conclusive, within-±5%-tolerance verification currently calls `extendPremium(orgId, tx)` directly inside the same transaction as marking the payment `"paid"`. **This entire path is being replaced** — see "The core behavior change" below. The wrong-contract/address-mismatch auto-reject branch and the not-confirmed/not-found/fetch-error pending branch are both **staying exactly as they are** — only the within-tolerance branch changes.
- **No `NotificationLog` model exists on Vantra yet.** SpaceWorker has one already (from its own Task 8, shipped) — mirror its shape here (`id, userId?, eventType, channel, recipient, outcome, errorMessage?, createdAt`, indexed on `[userId, createdAt]` and `[eventType, createdAt]`) for consistency across the two products, not because any code is shared between them.
- **`components/billing-card.tsx`/`components/billing-crypto-panel.tsx`** are untouched by the multi-org work — still built around the old fixed $100/$29 quote shape. Confirm their current structure before rewriting (read both files first) rather than assuming the old V4.1 design doc's sketch still matches reality.
- **OpenNode is confirmed dead** — remove it, don't leave it dormant. `lib/billing.ts` (the OpenNode client), `app/api/billing/webhook/route.ts` (the OpenNode webhook handler), and the `Payment.openNodeChargeId` column / `method: "opennode"` branch are all dead code from here forward. Grep for `openNodeChargeId`, `opennode`, and any import of `lib/billing.ts` to find every remaining reference before deleting — don't leave a half-removed integration.

## The core behavior change, stated precisely

**Today**: a verified, within-tolerance BTC/USDT payment auto-extends premium directly.

**New (confirmed with the user, do not re-litigate)**: a verified payment — **whether within tolerance or not, no exception** — never auto-grants anything. It **credits the user's wallet balance** once an admin explicitly confirms it in a review queue. Spending that balance on premium (Activate/Renew) is a **separate, later action** the user takes from their dashboard once the wallet has funds. The existing ±5%-tolerance check becomes a **pre-fill suggestion for the admin's review UI**, not an approval gate.

Restated as a flow:
1. Customer enters **any amount** they want to add to their wallet (not a fixed $100/$29 quote), capped at **$5,000**.
2. Customer submits a tx hash (existing `BillingCryptoPanel` UI, same shape — see below for what changes in it).
3. **The moment they submit** (before any verification result is known): email the customer ("your payment is pending confirmation, you'll be notified once it's reviewed") and alert the admin via **both** Telegram and email with enough detail to act (user, claimed amount, method, tx hash, expected wallet address).
4. The existing on-chain verification (`verifyBtcPayment`/`verifyUsdtPayment`) still runs immediately, same as today, and its result (in-tolerance or not, confirmations, actual amount) is still recorded to `PaymentVerificationAttempt` — but instead of driving an auto-approve/flag branch, it just becomes data the admin sees.
5. **Auto-reject stays** for the two unambiguous-bad cases (wrong contract, address mismatch) — no reason to burden the admin queue with those, they're not genuine ambiguity.
6. Everything else (confirmed present + correct amount, confirmed present + amount mismatch, not yet confirmed on-chain) lands in the admin's payments review queue, showing the auto-detected on-chain amount as an **editable, pre-filled suggestion** the admin can accept as-is or correct.
7. Admin clicks **Confirm** (credits the wallet with whatever's currently in that editable field, emails the customer that their wallet was credited with that exact amount) or **Reject** (requires a message, emails the customer that message, no credit).
8. Later, separately, the customer spends wallet balance via **Activate Premium** ($100, first 30 days included) or **Renew** ($20/month) on a specific organization — both are thin wrappers around the existing `extendPremium(orgId)`.

## Data model changes

```prisma
model User {
  // ...existing fields unchanged...
  walletBalanceCents Int @default(0)
  notificationLogs   NotificationLog[]
}

model Payment {
  // ...existing fields unchanged EXCEPT:
  // amountUsd stays as the CLAIMED top-up amount in whole dollars (rename its
  // comment, drop the "100 initial, 29 per monthly renewal" convention — it's
  // now a free-entry amount the customer chose, validated 1-5000).
  // kind ("initial" | "renewal") is no longer meaningful for a wallet top-up —
  // repurpose it as "topup" going forward (new payments), leave existing rows'
  // historical "initial"/"renewal" values alone (don't backfill/rewrite them).
}

model NotificationLog {
  id           String    @id @default(cuid())
  userId       String?
  user         User?     @relation(fields: [userId], references: [id])
  eventType    String    // "payment_pending" | "payment_confirmed" | "payment_rejected" | ...
  channel      String    // "email" | "telegram"
  recipient    String
  outcome      String    @default("sent") // "sent" | "failed"
  errorMessage String?
  createdAt    DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([eventType, createdAt])
}
```

Migration additive throughout (new column with a default, one new table) — safe against the two existing real accounts. `npx prisma migrate dev --name add_wallet_and_notification_log` locally, deploy the same way every other Vantra migration in this project has been deployed (this one has no ordering dependency on a backfill script — it's purely additive, unlike the multi-org migration).

## Routes and logic to build/change

1. **`app/api/billing/checkout/route.ts`** — accept a free-entry `amountUsd` from the request body (was previously implicit/fixed), validate `1 <= amountUsd <= 5000` both here and client-side. Everything else about quoting (snapshot the live price, compute `expectedAmountCrypto`, create the `Payment` row) stays the same shape, just parameterized by the real requested amount instead of a fixed constant.

2. **`app/api/billing/manual/submit/route.ts`** — rewrite the within-tolerance branch:
   - **Remove** the `db.$transaction` block that calls `extendPremium` and returns `verificationStatus: "auto_approved"`.
   - **Replace** with: record the verification attempt as today (unchanged), mark the payment `verificationStatus: "pending_review"` (a new status value — distinct from the existing plain `"pending"` used for not-yet-confirmed-on-chain, so the admin queue can tell "not confirmed on-chain yet, customer should retry" apart from "confirmed on-chain, awaiting admin decision"), store `actualAmountUsd`/`confirmations` as today.
   - Send the "your payment is pending confirmation" email to the customer (reuse `sendEmail`), and the two-channel admin alert (`notifyAdmin` for Telegram + `sendEmail` to whatever address the admin-alert email path already uses elsewhere in this codebase — check `lib/telegram.ts`'s callers or the admin panel's own settings for an existing "admin email" concept before inventing a new env var). Log both sends to `NotificationLog`.
   - The wrong-contract/address-mismatch auto-reject branch is unchanged. The not-confirmed/not-found/fetch-error pending branch is unchanged (still returns 422, customer retries) — **do not** send the pending-confirmation email/admin-alert for these, only for a conclusive (confirmed-on-chain) result, regardless of tolerance match.

3. **New: `app/api/admin/payments/[paymentId]/confirm/route.ts`** (POST, admin-gated via `requireAdminSession`) — body `{ amountUsdCents: number }` (the admin's final number, pre-filled client-side from `actualAmountUsd` but editable). Validates the payment is in `verificationStatus: "pending_review"`, credits `User.walletBalanceCents += amountUsdCents` and sets `Payment.status: "paid"`, `verificationStatus: "manually_approved"`, `reviewedAt: now()`. Emails the customer that their wallet was credited with that exact amount. Logs the send.

4. **New: `app/api/admin/payments/[paymentId]/reject/route.ts`** (POST, admin-gated) — body `{ message: string }` (required, non-empty). Sets `Payment.status: "rejected"` (or keep `verificationStatus` distinguishing admin-rejected from the existing automated-rejected outcome if useful for the audit trail — your call, a simple `verificationStatus: "manually_rejected"` is enough). Emails the customer the admin's message. Logs the send.

5. **New: `app/api/organizations/[orgId]/activate-premium/route.ts`** (POST) — requires the caller to own `orgId`, `walletBalanceCents >= 10000`, and the org currently `plan: "free"`. Deducts $100 from the wallet (in the same transaction as calling `extendPremium(orgId)`), sets premium for 30 days (the existing "first $100 already includes month 1" promo — no separate day-1 debit).

6. **New: `app/api/organizations/[orgId]/renew-premium/route.ts`** (POST) — requires ownership, `walletBalanceCents >= 2000`, org currently `plan: "premium"` (renewing early or right after expiry both fine, matches `extendPremium`'s existing `max(now, current expiry)` stacking). Deducts $20, calls `extendPremium(orgId)`.

7. **Remove OpenNode entirely** — delete `lib/billing.ts`, delete the OpenNode branch/handler in `app/api/billing/webhook/route.ts` (if the whole route becomes dead as a result, delete the route file itself and remove any reference to it), remove `Payment.openNodeChargeId` from the schema in a follow-up migration or leave the column as a harmless historical artifact if dropping it isn't worth a second migration this pass — your call, but the *code path* must be gone either way, not just unreachable.

## Widened free-tier gating (confirmed decision, not yet built by the multi-org task)

The multi-org task re-pointed the *existing* premium gates (Remote Tools) to read `Organization.plan` instead of `User.plan` — it did **not** add new gates. Per the confirmed decision: **reboot/shutdown/ping/terminal/scripts must now also require premium**, not just Remote Tools. Find wherever `canAccessAgent` (no premium check, only ownership) currently gates the reboot/shutdown/ping routes and either add a premium check there or introduce a second helper (`canPerformAgentAction`, matching `canAccessPremiumRemoteTools`'s existing shape: `plan === "premium"` AND ownership, no staff bypass) and switch those specific routes to use it. **Adding a device and viewing its status/checks stays free** — only actions *on* a device (not viewing it) get gated. Confirm with a live test: a free-org user can add a device and see it in the list, but reboot/shutdown/ping/run-script all return a clear "requires Premium" error, not a silent failure.

## UI

- **`components/billing-card.tsx`** — real rework: show `walletBalanceCents` prominently (this is shared across all the user's orgs, render it once, not per-org), a "Top up wallet" flow with a free-entry amount field (capped $5,000, replacing whatever fixed-quote UI exists today — read the current file to see exactly what needs replacing), and, **per-organization** (if the org switcher already renders a list of the user's orgs somewhere reachable from Settings/Billing, hook into that; if not, a simple org picker here is fine), an "Activate Premium ($100)" / "Renew ($20)" button pair, disabled with a clear reason (e.g. "Add $23 more to activate") when the wallet balance is insufficient.
- **`components/billing-crypto-panel.tsx`** — the free-entry amount input feeds into the existing checkout-quote step; the tx-hash submit step's result copy needs updating (it no longer says "your premium is now active," it says something like "thanks — we'll review this and credit your wallet once confirmed").
- **Admin `/admin101/payments`** — the payments table needs a new state for `verificationStatus: "pending_review"` rows: show the claimed amount, method, tx hash, submitting user, and an **editable amount-received field** pre-filled from `actualAmountUsd`, with Confirm/Reject buttons wired to the two new routes above. Existing rows/statuses (paid via the old flow, rejected, etc.) keep rendering as they already do — this is additive to the existing table, not a rewrite of it (read the current admin payments page/component before changing it).
- **New admin Notifications tab** (mirroring SpaceWorker's, already shipped there) — lists every `NotificationLog` row, paginated, filterable by outcome. Copy SpaceWorker's `NotificationsTab` component/route shape (`app/admin/(protected)/admin-panel.tsx`'s `NotificationsTab` + `app/api/admin/notifications/route.ts` on that repo) as a structural reference — same idea, adapted to Vantra's own admin panel layout (`/admin101`, not `/admin`).

## Verification

1. Submit a real small BTC or USDT-TRC20 payment, confirm the customer gets a "pending confirmation" email and the admin gets both a Telegram message and an email, immediately on submission — before any admin action.
2. Confirm the payment lands in the admin review queue with the correct pre-filled amount from the real on-chain check, regardless of whether it happens to be within the old ±5% tolerance or not (there should be **no path** where it auto-credits without an admin click, test this specifically since it's the core behavior change).
3. Admin edits the pre-filled amount and clicks Confirm — confirm `walletBalanceCents` is credited with the *edited* number, not the original on-chain-detected one, and the customer gets the credited-amount email.
4. Admin rejects a different payment with a message — confirm no credit happens and the customer receives that exact message.
5. With a credited wallet ≥ $100, Activate Premium on one specific org — confirm exactly $100 is deducted, that org's `premiumExpiresAt` is now+30 days, and a *different* org owned by the same user is unaffected (still free).
6. With wallet ≥ $20, Renew a premium org — confirm $20 deducted, expiry extended from `max(now, current expiry)`.
7. Attempt Activate/Renew with insufficient balance — confirm a clear blocked state, not a silent failure or partial deduction.
8. Confirm a free-org user can still add a device and view its status, but reboot/shutdown/ping/scripts/Remote Tools all correctly require Premium.
9. Grep the whole repo for `openNodeChargeId`/`opennode`/`lib/billing` — confirm zero live references remain (config/env vars can stay unused/ignored, just no code path depends on them).
10. Confirm the admin Notifications tab lists real rows for every send this task adds (pending-confirmation email, admin alert, confirmed email, rejected email).
