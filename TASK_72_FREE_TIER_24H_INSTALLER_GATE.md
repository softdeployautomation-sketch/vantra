# Task 72 — Free tier: 24h to generate installers, then a paywall (Terminal/Remote unchanged)

**Depends on Task 69 landing first** — this reuses `lib/exe-trial.ts`'s `startExeTrialIfNeeded`/`getExeTrialState` (the server-authoritative, account-level 24h clock Task 69 built for the EXE wrapper) as the SAME clock for this general dashboard-wide policy. Don't build a second trial timer.

## The policy, confirmed with the owner 2026-09-21

Replaces whatever free-tier install/move restriction existed before this (not time-limited, and predates several other changes this session — no longer the intended behavior):

- **Within 24h of the trial starting**: a free-tier user can generate installers of ANY method (including zip — no method-specific gate) to test the install flow, and can see their device list + device details, exactly like today.
- **Terminal/Remote console access**: unchanged — already correctly premium-only, permanently (`app/console/[agentId]/page.tsx`'s `plan === "premium"` check). Not time-limited by this task; don't touch it.
- **After 24h elapses**: a free-tier user can still SEE their existing devices (list + details stay open — don't touch device-view routes), but can no longer generate NEW installers of any kind until they upgrade to premium. Existing installers/deployments already generated keep working as before (this only gates NEW generation).

## What's already real vs. what's missing (checked live 2026-09-21)

- Confirmed: **there is currently no plan-based gate on installer generation at all** — `app/api/devices/deployments/route.ts`'s zip branch only checks env config (generator configured), not plan; the UI (`components/add-device-modal.tsx`) shows all four methods regardless of plan. This task ADDS the first such gate, it doesn't tighten an existing one.
- Confirmed: `lib/exe-trial.ts`'s `startExeTrialIfNeeded(userId)` is idempotent (never extends an already-started trial) and currently only called from `app/api/exe-trial/start/route.ts` (the EXE wrapper's own first-launch flow) — a user who only ever uses the web dashboard, never the EXE, currently never gets `trialStartedAt` set at all.

## Scope

1. **Start the same clock at regular web signup too**, not just EXE first-launch — call `startExeTrialIfNeeded(user.id)` from the web signup/verification path (check `app/api/auth/signup/route.ts` and `app/api/auth/verify/route.ts` for the right point — probably on successful email verification, matching where `ensureOrgProvisioned` already runs) so every free user has a real trial window from day one, whether or not they ever touch the EXE. A user who verifies on the web AND later opens the EXE must NOT get a second, later-starting trial — `startExeTrialIfNeeded`'s idempotency already guarantees this as long as both paths call the SAME function on the SAME user row.
2. **Gate installer generation** in `app/api/devices/deployments/route.ts`'s POST handler: for a free-tier org (`org.plan !== "premium"` and caller isn't staff — mirror the existing `entitled = isStaff || org.plan === "premium"` pattern already in that file), call `getExeTrialState(user.id)`; if `!active` (trial started and expired — NOT the same as "never started", see note below), reject with a clear, actionable error (something like "Your 24-hour trial has ended — upgrade to premium to generate more installers.") before any TRMM/generator work happens. Premium orgs and staff are never gated by this at all.
3. **Never started yet** (`trialStartedAt` null — shouldn't happen after scope 1, but guard anyway): treat as "start it now" via `startExeTrialIfNeeded`, then proceed as within-trial — don't accidentally block someone whose trial genuinely hasn't begun.
4. **Leave device view/list/details completely untouched** — no gate, no change, regression-check this explicitly since it's easy to accidentally over-widen a plan check.
5. **Leave Terminal/Remote (`app/console/[agentId]/page.tsx`) completely untouched** — already correct.
6. **UI**: surface the gate before the user hits the API error — e.g. in `components/add-device-modal.tsx` or the Add Device page, show remaining trial time / an upgrade prompt once expired, matching the existing upsell patterns elsewhere (`components/billing-card.tsx`'s Activate Premium flow — link there, don't build a second payment path).

## Out of scope

- Don't touch the private-tier lockout (Task 61's separate, permanent 403 for private orgs — unrelated axis, a private org has no installer flow regardless of plan or trial).
- Don't change premium/staff behavior at all.
- Don't add a device cap or count-based limit here — this is purely a time-based gate on generating NEW installers.

## Verification expected

- Fresh free-tier signup (web only, never opens the EXE): can generate any installer method for the first 24h; blocked after, with a clear upgrade message; can still see their devices.
- Fresh EXE-first user (never uses the web signup directly): same 24h window, started by the EXE flow, and if they later also use the web dashboard, the trial clock is NOT reset or extended.
- Premium org: never gated, regardless of trial state.
- Staff: never gated, regardless of org plan.
- Device view/list/details: completely unaffected in every case above, before and after the 24h.
