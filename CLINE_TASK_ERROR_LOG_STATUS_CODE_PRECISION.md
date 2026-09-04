# Cline Task — Make ApiErrorLog's statusCode honest for "log-and-continue" failures

**Repo**: `/Users/mikeolab/vantra`. **Scope**: `lib/api-error-log.ts`, `prisma/schema.prisma` (additive field), and the ~6 call sites listed below.

## The gap, found during review

`ApiErrorLog.statusCode` is documented as "the status returned to the client (or closest equivalent)". Most `logApiError(...)` call sites are followed immediately by a `return NextResponse.json(..., { status: X })` with a matching `X` — those are fine, don't touch them.

But a handful of routes log a failure and then **still return success to the client** because the failing operation was a secondary/background step, not the main point of the request. Confirmed examples:

- `app/api/admin/payments/[paymentId]/confirm/route.ts` — logs `statusCode: 500` when the wallet-confirmed email fails to send, but the route still returns `{ ok: true }` (200) since the payment itself was confirmed correctly.
- `app/api/admin/payments/[paymentId]/reject/route.ts` — same pattern.
- `app/api/auth/verify/route.ts` — logs `502` on a notification-send failure, still returns 200 for the actual verify.
- `app/api/billing/manual/submit/route.ts` — two call sites, same pattern, real response is 202.
- `app/api/device-groups/[groupId]/members/route.ts` — logs `502`, returns 200 with the member list.
- `app/api/internal/telegram-device-check/route.ts` — logs `502` mid-loop, endpoint still returns success overall.

This isn't silently swallowing anything — `errorMessage`/`stack` are accurate in every case — but an admin scanning `/admin101/errors` sees a `500`/`502` row and would reasonably read that as "a user got an error," when actually the user's request succeeded and only a background step (an email, a notification) failed.

## The fix

1. Add a new field to `ApiErrorLog`: `clientReceivedSuccess Boolean @default(false)` — true when the overall request still returned a 2xx to the client despite this logged failure, false otherwise (the normal "the request itself failed" case). Write a real Prisma migration (see existing migrations in `prisma/migrations/` for the house style — plain SQL `ALTER TABLE`, no destructive changes).
2. Add a `clientReceivedSuccess?: boolean` param to `logApiError()` in `lib/api-error-log.ts`, defaulting to `false` so every existing call site keeps working unchanged unless explicitly updated.
3. Update the 6 call sites listed above to pass `clientReceivedSuccess: true`.
4. In the admin Errors tab UI (`app/admin101/(protected)/errors/page.tsx` / `components/admin/admin-errors-client.tsx`), visually distinguish these rows — e.g. a muted "background failure, request succeeded" badge instead of the normal red/error styling — so an admin scanning the list can immediately tell "real request failure" apart from "a secondary step failed but the user was fine."

## Explicitly not this task

- Don't touch any of the call sites where the logged status already matches the real response — that's the correct, common case, leave it alone.
- Don't try to guess at every possible log-and-continue site beyond the 6 listed — if you find more while you're in there, note them in your final report rather than silently fixing an unbounded set (that's a "flag it" situation, not a "silently expand scope" one).

## Verification

1. Trigger one of the 6 flagged failure paths for real (e.g. temporarily break the email send in the confirm-payment route) and confirm the resulting row shows `clientReceivedSuccess: true` and renders with the distinct styling in the admin UI.
2. Confirm a normal request-aborting failure (any of the untouched call sites) still logs `clientReceivedSuccess: false` (the default) and renders with the normal error styling — no regression to the existing behavior.
