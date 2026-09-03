# Cline Task — Device List Redesign + Device Groups

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code only, no VPS/infra changes needed for this task.

## Context

The current device list (`components/dashboard-client.tsx` + `components/device-card.tsx`) is a flat vertical stack of cards with no search, no grouping, and no bulk actions — every device is one `Card` in a `space-y-3` column. The user wants: (1) online/offline sub-sections, (2) the ability to create groups and move devices into them, (3) a visual style closer to a dense admin device list (dark rows, checkboxes, search) rather than the current spaced-out card stack.

**No TRMM API changes are needed for this task** — `listAgents()` already returns everything required (`hostname`, `status`, `client_name`, `site_name`, `last_seen`, `logged_username`, `operating_system`, `checks` rollup). The gap is entirely on Vantra's side: **there is currently no database table anywhere that references a TRMM `agent_id`** (confirmed by reading the full Prisma schema — `Deployment` tracks install events via `trmmSiteId`, not a live agent). Groups are a brand-new concept.

**Important ownership constraint, read carefully**: TRMM agents are never "owned" by a Vantra DB row — ownership is always re-derived live by calling `listAgents(clientId)` and checking whether the given `agent_id` is present in that list (see `lib/authz.ts`'s `assertAgentBelongsToClient`). Every group-membership route in this task **must** perform that same live check before allowing an `agent_id` to be added to a group — never trust a client-supplied `agent_id` as already belonging to the caller.

## 1. Prisma schema additions

```prisma
model DeviceGroup {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String
  createdAt DateTime @default(now())
  members   DeviceGroupMember[]

  @@unique([userId, name])
  @@index([userId])
}

model DeviceGroupMember {
  id        String      @id @default(cuid())
  groupId   String
  group     DeviceGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  agentId   String      // TRMM agent_id — opaque string, NOT a local foreign key (the device only ever lives in TRMM)
  userId    String      // denormalized owner, checked independently on every read/write — defense in depth
  createdAt DateTime    @default(now())

  @@unique([groupId, agentId])
  @@index([userId, agentId])
}
```
Add `deviceGroups DeviceGroup[]` to `User`. Run `npx prisma migrate dev --name add_device_groups` locally to generate the migration (Claude will apply it to the production DB the same way every prior migration in this project was applied — do not attempt to reach the production database yourself).

## 2. New API routes

### `app/api/device-groups/route.ts`
- `GET`: auth-gated (`getCurrentUser()`, same 401/403 pattern as every other devices route). Returns `{ groups: Array<{ id, name, agentIds: string[] }> }` for the current user (`db.deviceGroup.findMany({ where: { userId }, include: { members: true } })`, mapped to just the `agentId` strings).
- `POST`: zod `{ name: z.string().trim().min(1).max(60) }`. Create via `db.deviceGroup.create`. The `@@unique([userId, name])` constraint means a duplicate name throws a Prisma unique-constraint error — catch it and return 409 "You already have a group with that name."

### `app/api/device-groups/[groupId]/route.ts`
- `PATCH`: rename, `{ name }`, same validation. **Must** verify `db.deviceGroup.findUnique({ where: { id: groupId } })?.userId === user.id` first — 404 (not 403, matching the existing "don't leak existence" convention used throughout this codebase) if it belongs to someone else or doesn't exist.
- `DELETE`: same ownership check, then `db.deviceGroup.delete` (the `onDelete: Cascade` on `DeviceGroupMember.group` removes memberships automatically).

### `app/api/device-groups/[groupId]/members/route.ts`
- `POST` body: `{ agentIds: string[] }` (zod: array of 1–50 non-empty strings). Steps, in order:
  1. Ownership check on the group (404 if not the caller's).
  2. **Live TRMM ownership check**: call `listAgents(user.trmmClientId)` once, build a `Set` of real agent_ids the caller actually owns, and filter the requested `agentIds` down to only those present in that set. Silently drop any that aren't real/owned — do not error on them (a stale client-side list is a normal race, not an attack worth surfacing as an error).
  3. For each surviving `agentId`, `db.deviceGroupMember.upsert` (unique on `[groupId, agentId]`) so re-adding an already-grouped device is a no-op, not an error.
  4. Return the updated member list.
- `DELETE` body: `{ agentIds: string[] }` — same ownership check on the group, then `db.deviceGroupMember.deleteMany({ where: { groupId, agentId: { in: agentIds } } })`. No live TRMM check needed for removal (removing a group membership can never grant access to anything).

**Staff note**: these routes are for customers managing their own devices. If `user.isStaff`, `user.trmmClientId` may be null (staff aren't scoped to one client) — in that case skip the live-ownership filter and trust the `agentIds` as-is only for staff, mirroring the existing `isStaff` bypass pattern already used in `app/api/devices/route.ts`. Groups themselves are still scoped by `userId` either way (a staff member's groups are their own, not shared).

## 3. UI — `components/dashboard-client.tsx` + `components/device-card.tsx`

Do not attempt a pixel-for-pixel clone of the reference screenshot (a raw MeshCentral device list) — that has its own visual language which doesn't match Vantra's established dark theme (`bg-elevated`, `border-border`, `brand-*` tokens, `Badge` tones). Build the same **functionality** — checkboxes, online/offline split, groups, a search box — using Vantra's existing design system. Also: TRMM has **no "idle time" concept** in its API today (only `last_seen` — confirmed, this is not an oversight to fix, it genuinely doesn't exist). Do not fabricate an idle timer; show "Last seen {last_seen}" as today, just relocated into the new denser row layout.

### New state in `dashboard-client.tsx`
- `search: string` — client-side filter only (no new API param) over `hostname`, `client_name`, `site_name`. No backend change.
- `groups: DeviceGroup[]` fetched from `GET /api/device-groups` alongside the existing device fetch.
- `activeGroupId: string | "all" | "ungrouped"` — which group filter is currently selected.
- `selected: Set<string>` (agent_ids) — for the new checkbox/bulk-action flow.

### Layout changes
1. Add a search `Input` (from `components/ui.tsx`) above the list, filtering by the fields above (case-insensitive substring match), computed client-side with `useMemo`.
2. Add a horizontal group-filter row (pill buttons, similar styling to `dashboard-nav.tsx`'s active-state pattern): "All", "Ungrouped", then one pill per `DeviceGroup`, plus a "+ New group" button opening a small `Modal` with a name `Input` and Create button (POSTs to `/api/device-groups`).
3. Split the filtered device array into two arrays: `status === "online"` vs everything else (`offline`/`overdue`), and render as two labeled sections ("Online (`n`)" / "Offline (`n`)") — each still using `DeviceCard`-style rows, just under a section heading. Collapsed/expanded state for each section can be simple local `useState<boolean>`, defaulting both to expanded.
4. Add a checkbox to the left of each device row (new prop on `DeviceCard`, or a thin wrapper). Track selection in the `selected` Set.
5. When `selected.size > 0`, show a bulk-action bar (fixed or sticky above the list): "{n} selected" + a `Select` populated with the user's groups + an "Add to group" button (`POST /api/device-groups/{id}/members`) + a "Clear selection" button. This is the **first multi-select pattern in this codebase** — there is no existing primitive for it (confirmed: zero matches for `bulk`/multi-select anywhere in the repo), so build it plainly with a `Set<string>` and checkboxes; don't over-engineer a generic reusable component for a single use site.
6. Devices already in the currently-selected group filter should visually indicate group membership (a small `Badge tone="neutral"` chip with the group name, or similar) — but a device can belong to zero, one, or multiple groups; don't assume exactly one.

### Row density
Tighten `device-card.tsx`'s padding/row-height compared to today's spaced-out `Card` stack — aim for a denser table-like row (checkbox, hostname + agent_id, status badge, last-seen, group chips) that reads as a real device management list rather than a marketing-style card grid. Keep the existing `Link` to the device detail page on the hostname text specifically (not the whole row anymore, since the row now needs to host a checkbox that must not trigger navigation).

## Verification

1. Create two groups, add the same device to both, confirm it shows both group chips and appears under both group-filter pills.
2. Confirm the online/offline split matches `agentStatusMeta` exactly (overdue counts as "offline" for this split, matching how `offline` tone is already the fallback).
3. **Security test**: as customer A, attempt `POST /api/device-groups/{A's group id}/members` with an `agentId` that actually belongs to customer B. Confirm it's silently dropped (not added), not just rejected with an error that would confirm the agent_id's existence.
4. Rename and delete a group; confirm deleting cascades its memberships without orphaning `DeviceGroupMember` rows.
5. Confirm the search box filters correctly and the bulk-action bar appears/disappears correctly as `selected` changes.
6. Full regression: confirm the existing per-device detail page navigation (clicking a hostname) still works unchanged.
