# Task 70 — Private-org naming/email on grant, and a real Add Device page for private orgs

**Replaces Task 67** (superseded, see that file — there is no migration to do; both existing orgs are already correctly private, and there are zero public-tier orgs in production to migrate). This task is the actual next step, confirmed with the owner 2026-09-21.

**Confirmed unchanged / do not touch as part of this task:**
- New self-service signup already always creates a `"public"` org (`lib/provision.ts`'s `createOrganizationWithClient`, Task 60) — no change.
- Only admin can grant a private org (`app/api/admin/users/[userId]/grant-private-organization/route.ts`, Task 60) — no change to WHO can grant, only to WHAT happens when they do (below).
- Public-tier orgs keep the normal self-service installer flow (`AddDeviceModal` in `components/add-device-page-client.tsx`) completely unchanged — this task only touches the private-tier branch of that same page.
- Staff rights (`User.isStaff`, the Technician Console gate, ticket assignment) — out of scope, don't touch.

## Scope

### 1. Private org: created unnamed, owner names it themselves, owner gets emailed

Today, `app/api/admin/users/[userId]/grant-private-organization/route.ts` accepts an optional admin-supplied `name` and falls back to the literal string `"Private"` — the admin effectively names it. Change:

- Drop the `name` input from the grant endpoint entirely (or ignore it) — always create with `name: ""`. This is the SAME "unnamed org" convention `lib/provision.ts`'s general first-org path already uses (`db.organization.create({ data: { ..., name: "" } })`), which `app/onboarding/page.tsx` already detects (`if (org?.name) redirect("/dashboard")` — falsy/empty name means "still needs naming").
- **The gap to close**: that onboarding check is keyed off `getActiveOrganization(user)` — the user's CURRENTLY ACTIVE org, not any org they own. A freshly-granted private org does NOT become the active org (Task 60 explicitly leaves `activeOrgId` alone), so simply reusing `/onboarding` as-is will never trigger for it unless the user happens to switch to it first. Read `app/api/onboarding/route.ts` and `components/onboarding-form.tsx` before deciding the mechanism — two reasonable options, pick whichever fits the existing code better without overengineering:
  1. Generalize the onboarding POST to accept an optional `orgId` (defaulting to active org for backward compat) and add a lightweight "name this organization" prompt/affordance in the org switcher itself (`components/org-switcher.tsx`, which Task 65 just touched) whenever it lists an org with an empty name — that row already renders per-org today, this is a natural place to catch it regardless of which org is active.
  2. Or: switching the org switcher's selection into an unnamed org redirects through the same `/onboarding` flow before landing on the dashboard for that org (matches the existing first-run UX exactly, just re-triggered by org-switch instead of only login).
  Either way: the grant must not leave a private org permanently unnamed with no discoverable way for the owner to fix it.
- **New**: on a successful grant, email the owner (reuse `lib/email.ts`'s `sendEmail` + add a new `privateOrgGrantedHtml(...)` template alongside the existing `walletCreditedHtml`/`verificationEmailHtml` ones — same file, same pattern). Tell them a private organization was granted to their account and that they can name it from the dashboard. Fire-and-forget is fine (same pattern as `notifyAdmin` calls elsewhere — don't let an email failure fail the grant itself), but log a failure via `logApiError` rather than swallowing it silently.

### 2. Add Device page for private orgs: replace the static panel with a real PowerShell-command generator

Today (`components/add-device-page-client.tsx`, Task 61): a private-tier org's Add Device page is a static message pointing the owner at the "Move to private organization" button on one of their public org's devices. That button (Task 63) still exists and still works for the common case — **don't remove or duplicate it**. This task adds the SECOND option the owner asked for: a raw, copy-pasteable version of the same underlying move for when the device isn't reachable for TRMM to run a script on it remotely right now (offline, flaky connectivity, or the owner just prefers to run it by hand over RDP/console).

**Scope of what this command can target — confirmed with the owner, do not widen this**: exactly the same device set Task 63's move button already allows — a device currently sitting in one of the CALLER'S OWN public-tier orgs. This is not a general "point any TRMM agent at my org" tool; it's an alternate delivery mechanism (copyable script vs. automatic remote-run) for the identical, already-authorized move. Reuse the existing pieces, don't reimplement:
- Device/source resolution: the same "scan caller's own public orgs for the client containing this device" logic already in `app/api/devices/[agentId]/move/route.ts`'s customer `GET`/`POST` branches.
- The script itself: `lib/trmm.ts`'s `buildAgentDomainMoveScript` (Task 62) — the exact command Task 63's automatic flow already runs remotely. Generating it for manual copy-paste is a presentation change, not new script logic.
- Destination resolution: `lib/device-move.ts`'s `resolveMoveDestination` (this org itself, since the owner is on the private org's Add Device page).

Concretely: the private-tier branch of `AddDevicePageClient` gets a device picker (devices from the owner's own public orgs — reuse whatever the devices list already fetches, e.g. `/api/devices`) and, once one is selected, displays the generated PowerShell command in a copyable code block — same shape as any other "copy this command" UI already in the app (check `add-device-modal.tsx` for the existing copy-to-clipboard pattern used for the normal installer commands, reuse it rather than building a new one). Running that command still results in the SAME `moveDeviceToPrivate` state (device reassigned + reconfigured) — if there's a clean way to have the manually-run script report completion back (e.g. it already hits a Vantra endpoint as part of Task 62's reconfigure step), reuse that; if not, this is fire-and-forget from Vantra's side once the command is generated — the device will simply start checking in under the private org once the script actually runs, same as it does today via the automatic path.

## Out of scope

- Don't touch the admin-only `unbindExeLicense`/EXE-license machinery — unrelated system, different task (69).
- Don't widen who can grant a private org, and don't let a non-admin self-service into one.
- Don't change the "one device, one API-driven move at a time" behavior — the copy-paste path is an alternate DELIVERY of the same move, not a bulk tool.

## Verification expected

- Admin grants a private org to a test user: the org is created with an empty name, the user gets emailed, and the user has a real, discoverable way to name it (not stuck with a permanently-blank org in the switcher).
- The public-org Add Device flow (installer generation) is completely unchanged — regression-check it, since `components/add-device-page-client.tsx` is being edited.
- Task 63's one-click move button still works unchanged after this — the new copy-paste option is additive.
- The generated PowerShell command, run manually on a real disposable test device currently in one of the test owner's public orgs, results in that device showing up under the private org in TRMM — same end state as the one-click button, just triggered by hand.
- A private-org owner cannot generate a move command for a device that isn't in one of their OWN orgs (try it with a device under a different owner's org — must be rejected, same as Task 63's POST already enforces).
