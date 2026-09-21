# Task 69 — EXE free-trial account, upgrade path, license loading, and locked-out support

**Why now (owner, 2026-09-21):** the EXE is becoming the primary distribution channel — most customers will get Vantra as the desktop wrapper going forward, not the bare web app. Everything below is about making that path self-contained: sign up, trial, pay, get licensed, move machines, and get help, all without needing an admin to click anything for the common cases.

**Read this section before writing any code — most of the plumbing already exists.** This task wires new surfaces onto existing infrastructure; it does not replace it. Building any of these from scratch would duplicate real, working code:

- `lib/exe-license-issue.ts` (`issueExeLicense`) — mints an unbound license, already the single shared issuer for admin + self-service. Reuse as-is.
- `lib/exe-license-bind.ts` (`bindExeLicenseToMachine`, `transferExeLicenseToMachine`, `unbindExeLicense`) — the one-machine-one-account invariant, idempotent bind, and **self-service auto-transfer to a new machine already works today**: `app/api/exe-license/self-service/route.ts`'s Case 4 calls `transferExeLicenseToMachine` directly for the caller's own logged-in session, no admin step. If the owner's "move to another machine" ask turns out to already work end-to-end once a user can log in, say so rather than rebuilding it.
- `lib/exe-eligibility.ts` (`resolveExeEligibility`) — the single `isStaff OR plan === "premium"` gate used by both the admin issuance tool and self-service. This task needs a **trial** tier added to this decision (see scope item 1) — extend it, don't fork a second eligibility check.
- `components/exe-license-self-service.tsx` + `app/api/exe-license/self-service/route.ts` — the existing Settings card (generate / register-this-device / already-bound states). Extend this, don't build a parallel binding UI.
- `components/billing-card.tsx` — **already has an "Activate Premium ($X)" button right next to "Top up wallet"** (same card, `canActivate`/`missingActivate` already computed). Before building anything for scope item 3 below, confirm live whether this is simply not visible/discoverable enough from the EXE's flow — it may already satisfy that ask and only need a pointer to it, not new code.
- `app/api/auth/signup`, `app/api/auth/login` — the existing email+password account creation/auth. Reuse this for scope item 1's account creation; do not hand-roll a second password path.
- `components/exe-gate.tsx` — the EXE's splash screen. Per its own comment, it **never blocks** on license/trial state today — every outcome continues straight to the hosted app. Scope item 1 changes what happens on FIRST launch specifically (no account yet); don't reintroduce a hard block for every other state, that was deliberately removed (2026-09-19 redesign, see the comment at the top of that file).

## Scope

### 1. Tie the free trial to a real account, not an anonymous machine clock

Today (`lib/license-state.ts` + `app/api/exe-license/status/route.ts`): the 24h trial is tracked in a local file on the machine, no server authority, no email. It's trivially reset by wiping local state, and there's no account to recover if the machine is lost.

Change: on first EXE launch (no local activation AND no local trial-start recorded yet), show a lightweight screen collecting **email + password** before starting the trial. This:
- Creates a real `User` row via the existing `/api/auth/signup` path (reuse it — same password hashing, same `emailVerified` flow) if the email is new, or logs them in if it already exists (an existing customer opening the EXE for the first time shouldn't be told to "sign up" again).
- Starts the 24h trial **server-side**, tied to `userId`, not just the local file — so re-trialing by wiping local state no longer works, and the trial has a real account behind it from minute one (this is also what makes "recover your account with no license on that device" possible, per the owner's ask — the credentials exist independent of any device state).
- `resolveExeEligibility` needs a third outcome here: currently `eligible` is a strict boolean (isStaff OR premium). Add a `"trial"` state (distinct from `eligible: true`) that the EXE side can use to decide whether to show trial-remaining UI vs. the upsell — don't collapse trial into `eligible: true`, a trial account should not pass the SAME gate a paying customer does elsewhere (e.g. don't let a trial account mint a full 180-day `ExeLicense` the way `issueExeLicense` does for premium — that's scope item 2/3's job once they actually pay).
- Local file state can still cache the trial window for fast offline UI, but the server row is the authority `stillValidLive`-style checks (already a pattern in `app/api/exe-license/status/route.ts`) reconcile against.

### 2. Fix the Settings upsell copy mismatch (found live 2026-09-21, not yet fixed)

`components/exe-license-self-service.tsx`'s up-sell panel says "A license is included with a premium plan — upgrade to generate one" for anyone `!eligible`. Once scope item 1 ships, a free-trial user IS a real logged-in account, just not premium yet — the copy should distinguish "you're on a trial, N hours left, upgrade to keep it licensed permanently" from a generic paywall message. Use the new trial state from scope item 1 to branch this.

### 3. Confirm (don't necessarily rebuild) the upgrade path is reachable

Verify live whether `billing-card.tsx`'s existing "Activate Premium" button is actually visible/reachable from the flow a free-trial EXE user takes (Settings, same page the self-service license card lives on). If it's already there and just needs to be more prominent for a trial user specifically (e.g. shown inline near the trial-remaining message from scope item 2, not just lower down in a separate wallet card), that's a placement/copy change, not new payment plumbing — don't build a second "upgrade" button or a second payment path.

### 4. A directly-reachable "load license" page

Today, binding a license to a machine only happens via `components/exe-license-self-service.tsx`, buried in `/dashboard/settings`, and mostly assumes the desktop app's own auto-handoff already supplied a Device ID in the URL. Add a page reachable directly (e.g. `/activate` or similar — check `app/activate-complete/page.tsx` first, this may extend that existing route rather than needing a new one) where a user who has a license (post-upgrade) but is on a fresh/reinstalled machine can:
- Log in with email + password (reuse `/api/auth/login`).
- Trigger the existing bind/transfer flow (`self-service/route.ts`) against THIS machine's auto-detected UUID (`getMachineId()` — reuse, don't re-derive machine identity).

This is largely wiring, not new binding logic — the hard part (one-machine-one-account, idempotent bind, auto-transfer) already exists.

### 5. Locked-out support: unauthenticated contact surface

Confirmed live 2026-09-21: `Ticket`/`TicketMessage` (`prisma/schema.prisma`) both require a real `userId` FK — there is currently NO way to reach support without a working login, and `app/api/tickets/route.ts` is fully session-gated. A user who lost their password AND has no working license/device has no path to anyone today.

Add a small, separate, **unauthenticated** contact surface — do not weaken `Ticket`'s FK requirement to accommodate this, that integrity is there on purpose (author identity on every ticket message). Concretely:
- A new lightweight table (e.g. `SupportContact`: `id`, `email`, `message`, `createdAt`, `resolvedAt` nullable) — no `userId` FK, since the whole point is the caller may not have a recoverable account session.
- A public POST route + a simple page (reachable from the EXE's own splash/expired states and from the web login page — "locked out? contact us") that takes email + message, rate-limited (reuse `lib/rate-limit.ts`, same pattern as the other public routes like `/api/exe-license/eligibility`).
- Surface these in `/admin101` (a simple list, reuse the existing admin table patterns) and notify staff the same way other admin-relevant events do (`notifyAdmin` in `lib/telegram.ts`, already used in `exe-license-bind.ts`) so it's not a silent inbox nobody checks.
- Staff respond by reaching out directly (email — reuse `lib/email.ts`) to the address the person gave; if it turns out they do have an account, staff can point them at password reset / the real ticket system from there. This is a triage inbox, not a replacement for `Ticket`.

## Out of scope

- Don't touch `lib/exe-license-bind.ts`'s one-machine-one-account invariant or the admin-only `unbindExeLicense`/transfer-audit path — those are deliberate DRM boundaries, not part of this task.
- Don't change what happens for an already-licensed (premium/staff) EXE user — `exe-gate.tsx`'s "always continue to hosted app" behavior stays exactly as-is for everyone except the true first-launch-no-account case in scope item 1.
- Don't build a second payment method — the existing crypto top-up + wallet-spend-on-Activate/Renew flow (`billing-card.tsx`, `app/api/organizations/[id]/activate-premium`) is what scope item 3 should point at, not replace.

## Verification expected

- Fresh EXE install, no prior account: first launch asks for email + password, creates the account, starts a real server-tracked 24h trial. Wiping local app state and relaunching does NOT reset the trial (server is authoritative).
- An EXE opened by an EXISTING customer (already has an account, e.g. via the web) does not get incorrectly told to "sign up."
- Settings shows trial-remaining messaging (not the generic premium upsell) for a trial account, with a clear, reachable path to Activate Premium.
- After a real Activate Premium (wallet-funded), the account becomes `eligible: true` via the existing `resolveExeEligibility` path, and can mint + bind a real 180-day license exactly as today.
- A user with an existing license, opening the EXE on a brand-new machine, can log in and end up licensed on that machine via the "load license" page, without needing to already have a Device-ID-carrying URL handoff.
- Submitting the locked-out contact form with no session succeeds, rate-limits on abuse, shows up in `/admin101`, and fires the existing Telegram admin notification.
