# Task 24 — Gate technician-only tools behind `isStaff`, not just premium

**Status: ready to implement.** Written 2026-09-10. Confirmed against the current codebase (not assumed) via direct grep of `lib/agent-route.ts` and every route under `app/api/devices/[agentId]/**`.

## Why this exists

V4's decision (already shipped) made Remote Tools a plain premium feature with no staff distinction — `authorizePremiumAgentAction` gates every device route uniformly, and `RemoteTools` doesn't receive an `isStaff` prop at all today. The user now wants a narrower split: **plain remote control** (Full Control / view-only connect) should stay available to any premium customer exactly as today, but the **technician-only tooling** — Connect to Backend, the standalone Terminal section, and Start Maintenance — should only be usable by staff, regardless of the customer's plan. A premium customer should never see these three things; only a staff member viewing any premium customer's device should.

No new data model is needed — this reuses `User.isStaff` (already exists, already used for the ticket system and `canAccessAgent`'s reboot/shutdown/ping bypass) combined with the existing premium/ownership check.

## Confirmed current state (read directly, not assumed)

`lib/agent-route.ts` has three existing helpers: `authorizeStaffAction` (isStaff only, no ownership check — used elsewhere, e.g. tickets), `authorizePremiumAgentAction` (premium + ownership, no staff check), and a third one for run-script. Every route below currently uses `authorizePremiumAgentAction`:

| Route | Feature | New gate |
|---|---|---|
| `app/api/devices/[agentId]/mesh/route.ts` | Full Control / view-only iframe URLs | **unchanged** — premium only |
| `app/api/devices/[agentId]/mesh/view-only/route.ts` | view-only share link | **unchanged** — premium only |
| `app/api/devices/[agentId]/cmd/route.ts` | standalone Terminal run-command | **staff + premium** |
| `app/api/devices/[agentId]/queue-command/route.ts` (GET+POST) | queue-until-online commands | **staff + premium** |
| `app/api/devices/[agentId]/queue-command/[queueId]/route.ts` (DELETE) | cancel queued command | **staff + premium** |
| `app/api/devices/[agentId]/maintenance-overlay/route.ts` | Start/Stop Maintenance | **staff + premium** |
| `app/api/devices/[agentId]/processes/[pid]/route.ts` | Backstage: kill process | **staff + premium** |
| `app/api/devices/[agentId]/software/route.ts` (both handlers) | Backstage: list/install software | **staff + premium** |
| `app/api/devices/[agentId]/software/uninstall/route.ts` | Backstage: uninstall | **staff + premium** |
| `app/api/devices/[agentId]/services/[serviceName]/route.ts` | Backstage: service control | **staff + premium** |

`components/remote-tools.tsx` currently has no `isStaff` prop at all; `components/agent-detail-client.tsx` renders `<RemoteTools agentId={agentId} />` with no staff info passed through either.

## 1. New authz helper in `lib/agent-route.ts`

Add `authorizePremiumStaffAgentAction`, mirroring `authorizePremiumAgentAction`'s exact signature and return shape (so every call site below is a pure drop-in swap), but additionally requiring `user.isStaff`. Reuse `authorizePremiumAgentAction`'s own internals rather than duplicating the premium/ownership logic — call it first, then add the staff check on top:

```ts
export async function authorizePremiumStaffAgentAction(
  agentId: string,
): Promise<AuthResult> {
  const result = await authorizePremiumAgentAction(agentId);
  if ("response" in result) return result;
  if (!result.user.isStaff) {
    // 404, not 403 -- matches this file's existing "don't leak existence" convention
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return result;
}
```

(Match the exact `AuthResult` type and not-found status code already used elsewhere in this file — read `authorizeStaffAction`'s own body for the precise pattern to copy, since it already does an isStaff check the same way.)

## 2. Swap the import + call in the 8 routes listed above

For each of: `cmd/route.ts`, `queue-command/route.ts`, `queue-command/[queueId]/route.ts`, `maintenance-overlay/route.ts`, `processes/[pid]/route.ts`, `software/route.ts` (both GET and POST handlers), `software/uninstall/route.ts`, `services/[serviceName]/route.ts` — change the import from `authorizePremiumAgentAction` to `authorizePremiumStaffAgentAction` and swap the call site accordingly. Leave `mesh/route.ts` and `mesh/view-only/route.ts` completely untouched.

## 3. Thread `isStaff` down to `RemoteTools`

`components/agent-detail-client.tsx` renders `<RemoteTools agentId={agentId} />` today with no staff info. Find where this component gets the current user's data (likely a prop already passed from its parent server component/page, given `isStaff` is already used elsewhere in the agent-detail flow for reboot/shutdown/ping bypass logic) and thread an `isStaff: boolean` prop through to `<RemoteTools agentId={agentId} isStaff={isStaff} />`. If `agent-detail-client.tsx` doesn't currently receive `isStaff` itself, trace it back to whichever page/server component renders it (likely `app/dashboard/devices/[agentId]/page.tsx`) and add it there via the existing `getCurrentUser()` call already happening for the auth gate.

## 4. `components/remote-tools.tsx` UI changes

Add `isStaff: boolean` to `RemoteToolsProps`. Then:

- **"Connect to Backend"** (`ConnectOption` around line 193-197): wrap in `{isStaff && (...)}` so non-staff viewers never see this card at all — they only get the two remaining options (Connect to device / Connect with input suspended).
- **Standalone Terminal section** (`terminalSection`, built around line 537+ per its own comment "standalone, always-visible command runner (Task 18)"): wrap its rendering in the same `isStaff` check — non-staff viewers see no Terminal section on the page at all.
- **Start Maintenance / Stop Maintenance** (the `"maintenance-overlay"` Tools-menu item, id around line 662): only include this menu item in the Tools dropdown's item array when `isStaff` is true — construct the array conditionally (`...(isStaff ? [{ id: "maintenance-overlay", ... }] : [])`), matching the existing conditional-array pattern already used for `toggle-input-suspend`'s menu item (`if (connectMode !== "backend") { ... }` — same style, spread-conditional into the items array).

**Important**: hide these client-side for UX, but the routes above are what actually enforce this — a non-staff user manually POSTing to `/api/devices/{id}/maintenance-overlay` must still get a 404 regardless of what the UI shows. Don't treat the UI hiding as the security boundary.

## 5. Technician note about the Start Menu/Search limitation

Since only staff will see the Start Maintenance button after this change, add a short note directly in its UI — e.g., as a `title` attribute, a small caption under the button, or inline in the Tools menu near the maintenance-overlay item (whichever fits the existing component's patterns most naturally — use judgment matching this file's existing tooltip/description conventions):

> "While maintenance mode is on, avoid opening Start Menu or Search on the target machine — Windows renders them above the overlay, so they can briefly be visible to the person at the machine. Use already-open windows, File Explorer's address bar, or the Terminal section instead."

This is a real, current limitation (Windows reserves a privileged Z-order band for shell UI that no application window can render above, confirmed via live testing) — not a hypothetical caveat, so the wording should be direct, not hedged.

## Explicitly out of scope

- No changes to `mesh/route.ts` or `mesh/view-only/route.ts` — plain remote control stays premium-only, unchanged.
- No new Prisma model or per-customer flag — confirmed with the user that `isStaff` alone is the intended gate, nothing account-specific.
- Not attempting to fix the Start Menu Z-order issue itself in this task — that's a separate, ongoing research thread. This task only adds the note.
- No changes to `canAccessAgent`'s existing staff bypass for reboot/shutdown/ping, or the ticket system's use of `authorizeStaffAction` — unrelated, already correct.

## Part B — Admin: grant premium, grant staff, and a per-user detail page

Added 2026-09-10. Without this, Part A's `isStaff` gate has no UI to actually set `isStaff` at all (still manual SQL) — a real, practical gap now that staff-only tools exist.

### Confirmed current state

`app/admin101/(protected)/users/page.tsx` is a plain **server component** — no interactivity, no buttons, one `<tr>` per organization (grouped via `rowSpan` per user, since plan/premium live on `Organization`, not `User`, per the multi-org architecture). No `isStaff` column exists. Clicking a row does nothing.

`lib/premium.ts` already exports `extendPremium(organizationId, tx?)` — extends an org's premium by 30 days from `max(now, current expiry)`, sets `plan: "premium"`. **Reuse this directly** for the "grant premium" button rather than reimplementing the stacking logic.

### New API routes

- `app/api/admin/organizations/[orgId]/grant-premium/route.ts` — `POST`, `requireAdminSession()` gate (same pattern as every other admin route), calls `extendPremium(orgId)`, returns the new `premiumExpiresAt`. No request body needed.
- `app/api/admin/users/[userId]/set-staff/route.ts` — `POST { isStaff: boolean }` (zod-validated), `requireAdminSession()` gate, `db.user.update({ where: { id: userId }, data: { isStaff } })`. A toggle (accepts `true` or `false`), not grant-only — an admin needs to be able to revoke staff status too, not just add it.

### Users list page — make it interactive

Convert the row rendering to a client component (`components/admin/admin-users-client.tsx`), following the exact pattern already established by `admin-payments-client.tsx`/`admin-vps-client.tsx`: the server page (`page.tsx`) does the same `db.user.findMany` + TRMM device-count fetching it already does, passes the result as an `initial` prop into the client component, which owns the interactive bits.

Additions to the table:
- **Email cell becomes a link** to `/admin101/users/[userId]` (the new detail page below) — this is the "click to see more info" ask.
- **New "Staff" column** (one per user, `rowSpan`-grouped same as email): a `Badge` showing the current `isStaff` state.
- **Grant Premium button** on each org row where `plan === "free"` (hidden/disabled once already premium — no button needed for an org already premium, since renewal isn't an admin action per the existing wallet-based renewal flow). Behind a `ConfirmDialog` (matches `admin-payments-client.tsx`'s existing confirm pattern), calls the new grant-premium route, shows a success/error toast, then refreshes.

### New per-user detail page

`app/admin101/(protected)/users/[userId]/page.tsx` (server component, same auth-gate pattern as every other protected admin page) → `components/admin/admin-user-detail-client.tsx`:
- User info: email, verified status, created date, current `isStaff` state with a **toggle button** (behind a `ConfirmDialog`, calls the set-staff route, "Grant staff access" / "Revoke staff access" depending on current state).
- List of the user's organizations (name, plan, premiumExpiresAt, device count — same data already computed on the list page, just scoped to one user) each with its own **Grant Premium** button (same behavior as the list page's, reused via a shared small component rather than duplicated).
- Keep this page reasonably scoped — link out to the existing `/admin101/payments` and `/admin101/tickets` pages (filtered by this user, if those pages already support a query-param filter; otherwise just a plain link to the general page) rather than embedding full payment/ticket history inline.

### Explicitly out of scope for Part B

- No changes to the wallet/renewal flow itself (`extendPremium` is reused as-is, not modified).
- No bulk actions (grant premium to multiple users at once) — one user/org at a time, matching every other admin action in this panel.
- Not adding a "revoke premium" button — only grant (matching the existing product decision that premium lapses naturally via `premiumExpiresAt`, never revoked early).

## Verification

1. `npx tsc --noEmit` + `npm run build` clean.
2. As a non-staff premium customer: confirm the device detail page shows only "Connect to device" and "Connect with input suspended" (no "Connect to Backend"), no standalone Terminal section anywhere on the page, and no "Start Maintenance" option in any Tools menu.
3. **Security check, not just UI**: as that same non-staff customer, manually POST directly to `/api/devices/{their-own-agent-id}/maintenance-overlay` (and one of the other 7 gated routes) and confirm a 404 — this is the real test, since client-side hiding alone is not enforcement.
4. As a staff user: confirm all three technician features are visible and functional on a premium customer's device exactly as before this change.
5. Confirm a staff user viewing a **free-tier** customer's device still correctly gets 404s from all of these (staff-only routes still require premium — `authorizePremiumStaffAgentAction` calls the existing premium check first, so this should already hold, but confirm rather than assume).
6. Confirm the Start Menu caveat text actually renders somewhere sensible near the Start Maintenance control.
7. Part B: grant premium to a free user's org from the admin Users list, confirm their dashboard reflects premium immediately and `premiumExpiresAt` is ~30 days out.
8. Part B: grant staff to a premium user via the detail page, confirm they can now see Connect to Backend / Terminal / Start Maintenance on their own devices (log in as that user or check via their session) — this is the live, end-to-end proof Part A and Part B correctly connect.
9. Part B: revoke staff from that same user, confirm the technician tools disappear again and the gated routes return 404 again.
10. Part B: click a user's email in the list, confirm the detail page loads with correct info and the grant-premium/set-staff buttons there work identically to the list page's.
