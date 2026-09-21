# Task 73 — Admin: delete an organization, with an explicit warning

**Owner request, 2026-09-21** (after manually deleting a mistakenly-granted private org via direct DB access for a test cleanup — this task makes that a real admin action instead of a one-off DB operation).

## Why this needs care, not a naive `DELETE`

Confirmed live this session (both from the original full-account-wipe cleanup and this task's own trigger): `Organization` has RESTRICT foreign keys from `Deployment`, `Organization.ownerId`, and others — a naive delete throws immediately. The full set of child tables that reference `organizationId` and must be cleared FIRST (confirmed against the live schema):

- `Deployment`
- `DesktopDeviceMirror`
- `DesktopInstall`
- `DeviceGroup` (and its `DeviceGroupMember` rows, cascade-checked)
- `Script`
- `TechnicianSessionLog`
- `DeviceLabel`
- `DeviceCredentialRequest`
- `DeviceCredential`
- `DeviceCredentialAuditLog`
- `DeviceAutoMove` (both `sourceOrgId` AND `destinationOrgId` — Task 64)

Check the current `prisma/schema.prisma` for the authoritative, up-to-date list rather than trusting this list blindly — new org-scoped tables may have been added since. Delete children in FK-safe order, ideally inside a single `db.$transaction([...])` (same pattern already used for the account-wipe cleanup earlier this session) so a failure partway through can't leave the org half-deleted.

**TRMM side**: the org's `trmmClientId`/`trmmSiteId` point at a real TRMM client/site. This task does NOT need to delete the TRMM client itself as part of the button — leave it orphaned (same posture as this session's own manual cleanup: an empty, unused TRMM client is low-risk clutter, not urgent). Deleting a TRMM client is a separate, higher-risk action (confirmed this session: the sandbox's own destructive-action classifier treats `deleteAgent`-class calls as requiring explicit authorization) — don't bundle it into this button without a very deliberate, separately-reviewed decision.

## Scope

1. **New admin route**: `DELETE /api/admin/organizations/[orgId]` (sibling of the existing `grant-premium` route in the same directory) — `requireAdminSession()`-gated like every other admin route.
2. **Device check first**: query TRMM (`listAgents(org.trmmClientId)`) for the org's current device count before allowing deletion.
   - **Zero devices**: straightforward delete, lighter confirmation.
   - **One or more devices**: this is real customer/test data — require a STRONGER explicit warning before the delete proceeds (see UI below). Never silently delete devices' records without the admin clearly seeing the count first.
3. **UI** (admin org list / user-detail page, wherever `grant-premium`'s button already lives): a "Delete organization" button that opens a confirm modal:
   - Always shows the org name, tier, plan, and current device count fetched live (not stale).
   - **Empty org (0 devices)**: standard confirm ("Delete this organization? This can't be undone.").
   - **Org with devices**: an explicit, harder-to-miskclick warning — e.g. require typing the exact org name to confirm (matching the weight of a genuinely destructive action), and state plainly that the devices' Vantra-side records (not the devices themselves, not their TRMM enrollment) will be removed.
4. **The delete itself**: clear all child tables listed above (re-verify against current schema) inside a transaction, then delete the `Organization` row. Leave the TRMM client/site as-is (see above).

## Out of scope

- Don't add TRMM client/site deletion to this action (see reasoning above).
- Don't allow a non-admin to reach this route — customer self-service org deletion isn't part of this task.
- Don't touch the existing `grant-premium`/`grant-private-organization` routes.

## Verification expected

- Deleting an empty org: org disappears from the admin list and the owner's org switcher, no error.
- Deleting an org WITH devices: the stronger warning actually appears and blocks accidental confirmation (e.g. wrong-name-typed must fail); after confirming correctly, all listed child tables are actually empty for that org id (query directly, don't just trust "no error") and the org row is gone.
- A non-admin request to the same route is rejected (401/403, matching every other admin route's posture).
- The org's TRMM client/site are confirmed UNCHANGED/still present after deletion (this action must not touch TRMM at all).
