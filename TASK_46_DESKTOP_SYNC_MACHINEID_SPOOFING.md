# Task 46 — Desktop sync mirror trusts a non-secret Device ID as a bearer credential

**Status: FIXED, 2026-09-21.** `lib/exe-license-bind.ts` now mints a fresh `randomBytes(32)` install secret on every bind/transfer (hash-only at rest, raw value returned exactly once; cleared on unbind). `lib/desktop-sync/mirror.ts`'s `resolveInstall` requires it (fail-closed, constant-time compare) for both new and already-registered installs — a correct-but-spoofed `machineId` alone is no longer sufficient. Live-verified: a sync pull with no `x-install-secret` header → `401`; correct secret → succeeds and auto-registers.

## The mechanism as built

`lib/desktop-sync/mirror.ts`'s `resolveInstall()` is the only authentication
for the hosted desktop-sync endpoints (`app/api/desktop/sync/pull`,
`app/api/desktop/sync/push`), which read/write a customer organization's
`DesktopDeviceMirror` rows (device labels, notes, tags, hostname/status
cache). Every request carries two headers: `x-install-id` and
`x-machine-id`. On first contact for a given `installId`, the server:

```ts
const bound = await db.exeLicense.findFirst({
  where: { boundMachineId: cleanMid, product: "vantra_exe" },
  select: { userId: true },
});
if (!bound) throw new MirrorAuthError(...);
// creates a NEW DesktopInstall row scoped to bound.userId's org,
// under the CALLER-CHOSEN installId
```

`installId` is minted client-side by the EXE (`lib/local-db`) and is never
validated against anything server-issued — the server accepts whatever value
the caller sends as long as the accompanying `machineId` matches *some*
bound `ExeLicense`. `machineId` itself (`lib/machine-id.ts`) is a 16-hex-char
(64-bit) hash of hardware identifiers — not cryptographically secret, and the
product's own UX treats it as shareable: `app/api/exe-license/status/route.ts`
returns it explicitly so the EXE's UI can show it as a "copyable" Device ID
for the buyer to hand to support/admin for claiming.

## Concrete failure scenario

Anyone who learns a legitimate customer's Device ID — pasted into a support
ticket, shown in a screenshot, read over a call, or simply observed by
someone with temporary local access to the machine (no admin access needed,
it's shown in the app's own Settings/EXE UI) — can mint an arbitrary,
self-chosen `installId` and call `POST /api/desktop/sync/pull` /
`/push` with `x-machine-id: <victim's Device ID>`. `resolveInstall()` will
happily auto-register a brand-new `DesktopInstall` scoped to the victim's
real `userId`/`organizationId`, because the only proof it demands is "you
know a machineId with a bound license" — which the product itself hands out
as a non-secret support artifact. From there the attacker can `pull` that
org's `DesktopDeviceMirror` rows (device labels/notes/hostnames — not
device-control access, but real reconnaissance data about a customer's
fleet) and `push` fabricated rows that get merged in via the LWW rule,
corrupting the customer's own desktop app's view of their devices. Neither
endpoint has any rate limiting either (`grep allowAndRecord` finds nothing
in `app/api/desktop/sync/**`), so this isn't even throttled.

This is a materially different, lower-trust model than the rest of the app's
device-credential work in the same task family, which correctly uses a
`randomBytes(32)` server-minted, hashed, single-use token
(`app/api/devices/[agentId]/request-unlock`) rather than trusting a
device-identifying value the product itself publishes to the user.

## Fix

1. Stop treating `machineId` alone as sufficient proof of identity for a
   *new* install registration. When `bindExeLicenseToMachine` /
   `transferExeLicenseToMachine` bind a license to a machine
   (`lib/exe-license-bind.ts`), mint a second, server-generated,
   high-entropy **install secret** (e.g. `randomBytes(32)`, stored hashed on
   the `ExeLicense` row or a new column) and return it alongside the bound
   license key. The EXE persists it locally and sends it as a third header
   (e.g. `x-install-secret`) on every sync call.
2. `resolveInstall()` requires a hash-match on that secret (not just
   `machineId` membership in the `ExeLicense` table) before auto-registering
   or accepting a request for an existing `installId`.
3. Add rate limiting to `app/api/desktop/sync/pull` and `.../push`
   (extend `RateLimitKind` in `lib/rate-limit.ts`, same pattern as every
   other public-input route) as defense in depth regardless of the auth fix.

## Explicitly out of scope

- Changing how `machineId` itself is derived (`lib/machine-id.ts`) — it's
  fine as a device-fingerprint input, the problem is using it alone as a
  bearer credential for a different subsystem than it was designed to gate.
- Any change to the licensing/activation flow itself (`activate`,
  `auto-bind`, `self-service`) — those were separately re-verified this audit
  and hold up.

## Verification expected

- `npx tsc --noEmit` clean; migration applied if a new column is added.
- Live: confirm a sync call with a correct `machineId` but no/incorrect
  install secret is rejected 401/403.
- Live: confirm the existing EXE sync flow (bind → sync → pull/push) still
  works end-to-end with the new secret wired through.
