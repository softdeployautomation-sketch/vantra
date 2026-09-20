# Task 48 — Admin grant-premium has no UI button (backend already works)

**Status: ready to build. Owner-requested 2026-09-21.** Small — not part of the active Batch 2 handoff (Tasks 45–47); this is a separate, later pickup so it doesn't disrupt whatever Cline is mid-way through in that batch. Handle after Batch 2 is done, or whenever convenient.

## What's requested

Owner: "grant a free user premium access for a certain period... also I should be able to give premium users more time like extend there expiry date."

## The good news — this already works, it's just not clickable

`lib/premium.ts`'s `extendPremium(organizationId, tx?)` and `app/api/admin/organizations/[orgId]/grant-premium/route.ts` already implement exactly this: extends an org's premium by 30 days from `max(now, current expiry)` (so extending early stacks instead of resetting), flips `plan` to `"premium"`, and is the SAME function the real payment-confirm and customer Activate/Renew flows use — a grant and an extension are literally the same call, and a granted org is indistinguishable from a paying one everywhere else in the app (check-on-read expiry reversion in `lib/session-user.ts:108-116` treats them identically). Confirmed via grep: `requireAdminSession()`-gated, grant-only (no revoke — matches the product decision that premium lapses naturally via `premiumExpiresAt`).

**The gap**: no admin page or button calls this route. `grep -rn "grant-premium" app/admin101` returns nothing. An admin has to `curl` it manually today.

## The fix

Add a "Grant/Extend premium (+30 days)" button to the admin org/user view (`app/admin101/(protected)/...` — find wherever the existing user/org list already lives, matching this repo's admin nav conventions) that POSTs to `/api/admin/organizations/[orgId]/grant-premium` and shows the returned `premiumExpiresAt` back to the admin immediately. Show the org's CURRENT `plan`/`premiumExpiresAt` in that same view too, if it isn't already visible somewhere — the admin needs to see current state before deciding whether they're granting fresh or extending.

No backend change needed. This is a pure UI task.

## Verification expected

- `npx tsc --noEmit` clean.
- Live: grant premium to a free test org via the new button, confirm the org's plan/expiry updates and the org gets real premium access; click it again, confirm the expiry stacks (moves further out, doesn't reset).
