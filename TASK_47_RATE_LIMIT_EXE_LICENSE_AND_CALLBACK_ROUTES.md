# Task 47 — Rate-limit the hosted, unauthenticated license + device-callback routes

**Status: FIXED, 2026-09-21.** `lib/rate-limit.ts` adds `exe-license-auto-bind` (10/hr), `exe-license-eligibility` (30/hr), `device-credential-callback` (20/hr), plus `desktop-sync-pull`/`push` (1200/hr, defense-in-depth alongside Task 46's new secret auth) — wired before any auth/DB work in each route, per the exact code the task file specified.

## The gap

`lib/rate-limit.ts` already has a clean, established pattern
(`RateLimitKind` + `RULES`, IP-based via `RateLimitEvent`) applied to
`signup`, `login`, `resend-code`, `verify`, `admin-login`,
`billing-manual-submit`, and `admin-service-action`. Grepping every route
under `app/api` for `allowAndRecord` shows three **hosted, internet-reachable,
session-less** routes that accept POST bodies from an unauthenticated caller
and never call it:

- `app/api/exe-license/auto-bind` — accepts `{ licenseKey, email, machineId,
  machineLabel }` from any caller (by design, the EXE has no web session
  here) and, on a valid signature + matching email, **binds a license to a
  machine** — a real state-changing, DB-writing action.
- `app/api/exe-license/eligibility` — accepts `{ email, licenseKey }` and
  hits the DB (`resolveExeEligibility` + an `exeLicense.findFirst` + an
  `update` for `lastCheckinAt`) on every call, unauthenticated.
- `app/api/device-callback/credential` — accepts `{ token, pin }` from a
  headless on-device script with no session; correctly requires a
  `randomBytes(32)`-derived one-time token first, but nothing stops an
  unlimited volume of guesses/noise against it before the token expires, or
  general resource-exhaustion traffic against the route.

None of these are the *most* severe class of bug (each still requires either
a correctly-signed license key or a genuinely valid one-time token to do
anything meaningful — they don't hand out access on volume alone), but they
are exactly the shape of route this repo's own rate-limit plan says needs a
guardrail, and every comparable public-input route in the app already has
one. Leaving these three out is an inconsistency, not a deliberate call.

## Concrete failure scenario

`auto-bind` and `eligibility` both run real Prisma queries (and `auto-bind`
runs a write) per request with zero throttling. A scripted flood of requests
against either — even with garbage `licenseKey`/`email` values that fail
validation immediately — still costs a DB round-trip per hit and is a cheap
way to add load to the single-instance Postgres this app runs against on the
shared Contabo VPS (the same box also runs TRMM's Django/Celery stack and
MeshCentral — see `TASK_43_QUEUE_ADMISSION_CONTROL.md`'s own framing of this
VPS as resource-constrained). `device-callback/credential` sits in the
middle of a real "type your PIN into a device-unlock prompt" flow (Task 25);
an unthrottled attacker who does obtain a live token (e.g. by intercepting
the on-device script before it fires) gets unlimited attempts against the
`pinLength` check with no lockout.

## Fix

In `lib/rate-limit.ts`, add:

```ts
export type RateLimitKind =
  | ... // existing
  | "exe-license-auto-bind"
  | "exe-license-eligibility"
  | "device-credential-callback";

const RULES: Record<RateLimitKind, Rule[]> = {
  ...
  "exe-license-auto-bind": [{ limit: 10, windowMs: 60 * 60 * 1000 }],
  "exe-license-eligibility": [{ limit: 30, windowMs: 60 * 60 * 1000 }],
  "device-credential-callback": [{ limit: 20, windowMs: 60 * 60 * 1000 }],
};
```

Wire `allowAndRecord(await getClientIp(), "...")` into each of the three
routes above, same shape as `app/api/auth/login/route.ts`'s existing call —
429 with a plain error message on rejection, before any DB work happens.

## Explicitly out of scope

- `app/api/exe-license/activate` — confirmed gated by `isLocalExeRuntime()`,
  never reachable on the deployed web server; not a shared-infrastructure
  target.
- `app/api/exe-license/self-service` and `/switch-to-web` — both
  session-gated (`getCurrentUser()` first), materially lower risk; leave as
  is unless abuse is actually observed.
- `app/api/billing/checkout` — session-gated and already bounds cost via the
  2-hour quote-reuse window; not urgent.

## Verification expected

- `npx tsc --noEmit` clean.
- Live: hammer `/api/exe-license/eligibility` past the configured limit,
  confirm a 429 with no DB write past the threshold; confirm the limit
  resets after the window.
