# Task — Self-service Vantra EXE license (no admin click needed)

**Status: ready to start.** Owner's explicit ask (2026-09-18): a premium/staff user shouldn't have to wait on an admin to hand-generate and bind their license — "we can still automate some processes."

## Why this is two problems, not one

Confirmed by direct code investigation of the current admin flow (`app/api/admin/exe-licenses/route.ts`):

1. **Issuance** (`handleIssue`, line 99) mints an UNBOUND key — a purchase reference the EXE refuses to activate.
2. **Binding** (`handleBind`, line 198, via `lib/exe-license-bind.ts`'s `bindExeLicenseToMachine`) is what actually makes it activatable — it re-signs the key with a specific machine's Device ID.

Both are admin-only today. Automating just issuance isn't enough — a self-serviced-but-unbound key still needs an admin to bind it before the buyer can activate. Automating both is what closes the loop.

## Why the offline EXE can't do this itself

`app/api/exe-license/activate/route.ts` runs entirely offline inside the installed EXE (`isLocalExeRuntime()`-gated, no `DATABASE_URL` shipped — confirmed, see `TASK_44_3_EXE_PACKAGING.md`). It CANNOT write to the central `ExeLicense` table, by design — that's the actual security boundary that makes machine-locking real. So binding has to happen on the **hosted web app**, where a real session + DB connection exist. The good news: the EXE already shows the user their own Device ID today (`components/license-settings.tsx:150-155`, and the trial/status API already returns `machineId`) — so the self-service web flow just needs the user to copy that already-visible value in, not build anything new on the EXE side.

## The flow this task builds

1. Logged-in premium/staff user opens **Settings → License** on the **web** dashboard (`components/license-settings.tsx`'s web-hosted branch — currently just a static "this section is only active inside the desktop app" placeholder; replace it for eligible users).
2. They've already installed the (generic, unauthenticated) EXE separately and can see their machine's Device ID on its trial screen.
3. They paste that Device ID into a field on the web Settings page and click one button.
4. Server-side, in one request: checks eligibility off their own session (no email input — always the caller's own account, unlike the admin route which takes an arbitrary email), mints a key if they don't already have an active one for this product (idempotent — repeat clicks return the same still-usable key, never mint duplicates), and binds it to the Device ID they just pasted.
5. The bound key is shown with a copy button. They paste it + their email into the EXE's existing activate form — it now activates immediately, no admin involved.

## Build this

1. **Refactor first**: extract `handleIssue`'s minting logic (`app/api/admin/exe-licenses/route.ts:141-176` — the `generateLicenseKey` call through the `db.$transaction` that creates the synthetic `Payment` + `ExeLicense` row) into a shared function (e.g. `lib/exe-license-issue.ts`). Both the existing admin route and the new self-service route call it — one implementation of "mint a key," not two that can drift.
2. **New endpoint**, e.g. `POST /api/exe-license/self-service` — session-gated (`getCurrentUser()` + `getActiveOrganization()`, the same pattern `app/api/devices/route.ts` uses), NOT admin. Body: `{ machineId: string, machineLabel?: string }`.
   - Eligibility via `resolveExeEligibility(user.email)` — reject with the same 403 shape the admin route uses (`plan`, `isStaff` in the body) if neither premium nor staff. No override escape hatch here — self-service only for genuinely eligible accounts.
   - Look up the user's existing non-expired `ExeLicense` for `product: EXE_PRODUCT`:
     - Already bound to this exact `machineId` → just return it (idempotent, no-op).
     - Unbound → bind it now to the given `machineId` (reuse `bindExeLicenseToMachine`), return the bound key.
     - Bound to a **different** machineId → reject with the existing "already active on another device — contact support to transfer" message. Do NOT auto-transfer here; that stays a deliberate admin action per the existing design (`transferExeLicenseToMachine`). A second device for the same user is a separate, not-yet-decided question — don't solve it in this task, just don't silently break the existing single-machine-lock guarantee.
     - No license at all → mint one via the refactored shared function, then bind it to the given `machineId` in the same request.
3. **UI**: `components/license-settings.tsx`'s web branch — replace the static placeholder for eligible users with the Device ID input + generate/copy button described above; keep (or improve) the existing upsell messaging for ineligible users.
4. **Stable download link**: there is currently no in-app way to actually download the EXE at all — the installer only exists as a CI artifact / optional draft GitHub Release (`tag_name` input on `workflow_dispatch`, `.github/workflows/build-exe.yml:17`). Mirror SpaceWorker's already-proven pattern (a static nginx `location` block serving from `/opt/vantra/downloads/` on the VPS, publishing a stable branded URL — NOT a raw github.com link) rather than inventing a new distribution mechanism. Put the download link next to the new self-service section in Settings.

## Explicitly out of scope

- Live eligibility re-checking on an already-activated install (the unwired `/api/exe-license/eligibility` poll route from Task 44.2c) — separate, already-flagged gap, not this task.
- Multiple simultaneous devices per user / self-service transfer — stays admin-only.
- Any change to Task 44.4's local-DB work — unrelated thread.

## Verification required before calling this done

1. `tsc`/`eslint` clean, matching this repo's baseline.
2. A real end-to-end test: an eligible test account generates a key via the new web flow, installs the EXE fresh, reads its Device ID, pastes both into the web form, gets a bound key back, activates in the EXE with zero admin interaction anywhere in the sequence.
3. Confirm the idempotency case (click the button twice — no duplicate `ExeLicense` rows).
4. Confirm the ineligible case (a free-tier account gets the eligibility error, no key minted).
5. Confirm the different-machine case still correctly rejects (paste a second, different Device ID after already binding one — must get the existing "contact support" error, not a silent rebind).
