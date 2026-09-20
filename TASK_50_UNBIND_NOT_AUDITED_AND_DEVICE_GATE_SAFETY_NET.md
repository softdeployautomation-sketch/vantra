# Task 50 — Unbind (including "switch back to web") isn't audit-logged; desktop-mode gating has no regression safety net

**Status: ready to build. Owner-requested 2026-09-21**, after testing "Switch back to web" live: the admin panel correctly showed the license flip to "Unbound," but the transfer history showed nothing for it — only device-to-device transfers are logged, a plain unbind isn't.

**Investigated and ruled out as non-issues (don't re-litigate)**: whether the EXE could keep working after a switch-to-web (it can't — `lib/session-user.ts`'s `getCurrentUser()` re-checks the bound device on every single authenticated request, not a periodic/lazy poll, and force-signs-out immediately on mismatch), and whether "Locked to desktop" mode is currently under-enforced on any live page (checked every `app/dashboard/**/page.tsx` — dashboard root, device detail, and add-device all correctly call `getDesktopModeGate()`; Settings/Support intentionally don't, matching the product's own "manage billing/support from any browser" design). Both are sound today.

## Finding 1 — `unbindExeLicense` writes no audit trail

`lib/exe-license-bind.ts`'s `unbindExeLicense(exeLicenseId)` clears `boundMachineId`/`boundMachineLabel`/`boundLicenseKey`/`boundAt`/`installSecretHash` — and writes nothing to `ExeLicenseTransfer` or any other audit table. Compare to `transferExeLicenseToMachine`, which atomically writes a `ExeLicenseTransfer` row alongside the rebind specifically so there's a durable "who moved what, when" record.

Every caller of `unbindExeLicense` inherits this gap:
- `app/api/exe-license/switch-to-web/route.ts` — a real, revenue-relevant customer action (revokes their own desktop license) with zero paper trail.
- `app/api/admin/exe-licenses/route.ts`'s admin unbind action — same gap, and this one matters even more: an admin action that isn't logged is exactly the "who did this and when" question support/billing disputes need answered.

### The fix

Give unbind the same audit treatment transfer already has. Either:
- Extend `ExeLicenseTransfer` to represent unbind too (e.g. `toMachineId: null` meaning "unbound," `toMachineLabel: null`), so one table/history view covers both — probably the smaller change since the admin UI already renders a transfer-history list per license; unbind would just show up as a new entry type in the same feed.
- Or add a small, separate `ExeLicenseUnbindLog` if overloading the transfer table's semantics feels wrong.

Either way: `unbindExeLicense` needs an `actor`/`reason` parameter threaded through from every caller (`switch-to-web` should record "self-service, licensee" as the actor; an admin unbind should record which admin) so the resulting log entry says WHO unbound it, not just that it happened.

## Finding 2 — desktop-mode gating has no regression safety net

`app/dashboard/layout.tsx`'s own comment explains this is deliberate: a shared-layout gate broke Settings/Support in live testing, so gating was moved to per-page opt-in (`getDesktopModeGate()` called individually in `app/dashboard/page.tsx`, `devices/[agentId]/page.tsx`, `devices/add/page.tsx`). Confirmed correct today. The risk is purely forward-looking: a new dashboard page added later that SHOULD be desktop-gated (shows real device/fleet data) has nothing forcing the author to remember to opt in — it would silently ship ungated.

### The fix (lower priority than Finding 1 — a safety net for the future, not a live bug today)

A lightweight regression test: enumerate every `app/dashboard/**/page.tsx`, and assert each one is EITHER on an explicit allowlist of "intentionally ungated" pages (Settings, Support, Support ticket detail) OR its source contains a call to `getDesktopModeGate`. This turns "someone forgot to gate a new sensitive page" from a silent ship into a failing test.

## Separate, non-code item to flag (not part of this task's build — needs the owner's call)

The `myrate619@gmail.com` account's transfer history currently shows pre-existing test debris ("Simulated second EXE (test) → Win32," "Windows VM test → Conflict guard test (free)") — leftover from earlier testing against what may become (or already is) a real account, not a disposable synthetic one. Don't delete these rows without the owner's explicit go-ahead (audit trails are generally append-only for a reason) — surface it to them and let them decide whether/how to clean it up.

## Verification expected

- `npx tsc --noEmit` clean; migration applied if the audit approach needs a schema change.
- Live: call `switch-to-web` (or trigger an admin unbind) on a disposable test license, confirm a real audit entry now appears showing who unbound it and when.
- If the regression-test approach is built for Finding 2: add a new dashboard page temporarily without calling the gate, confirm the test fails; remove it, confirm the test passes again.
