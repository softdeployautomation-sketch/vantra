# Cline Task — Multi-Organization Foundation

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code + one data-migration script. No VPS/infra changes needed (deploy is the usual build+rsync+restart, already documented elsewhere).

**Status**: this is the true unblocking piece for the wallet/credit billing work coming right after it (a separate task, not this one) — premium billing is per-organization, so `plan`/`premiumExpiresAt` have to move off `User` before that can be built. Get this one right first; the billing task depends on it.

## Why this exists

Confirmed with the user: an MSP/reseller use case — one login should be able to manage **several separate organizations**, each with its own TRMM client/site/device list, switchable "with just a button." Today `User` has a 1:1 relationship to a TRMM client (`trmmClientId`/`trmmSiteId`/`orgName`/`plan`/`premiumExpiresAt` all live directly on `User`) — this task moves that to a new `Organization` model, owned by a `User`, with the wallet balance staying shared on `User` (confirmed: one wallet per user, premium purchased per-org — the wallet itself is a separate follow-up task, not built here, but the `Organization.plan`/`premiumExpiresAt` fields this task creates are what that task will spend against).

## Data model

```prisma
model Organization {
  id               String    @id @default(cuid())
  ownerId          String
  owner            User      @relation(fields: [ownerId], references: [id])
  name             String    // customer-chosen, shown in the org switcher — replaces User.orgName
  trmmClientId     Int?
  trmmSiteId       Int?
  plan             String    @default("free") // "free" | "premium" — MOVED from User
  premiumExpiresAt DateTime? // MOVED from User
  createdAt        DateTime  @default(now())
  deployments      Deployment[]   // MOVED from User — devices belong to an org, not a user
  scripts          Script[]       // MOVED from User
  deviceGroups     DeviceGroup[]  // MOVED from User
  @@index([ownerId])
}
```

On `User`: **remove** `trmmClientId`, `trmmSiteId`, `plan`, `premiumExpiresAt`, `orgName` (all moved to `Organization`). **Add**:
```prisma
activeOrgId   String? // last-selected org — drives the switcher's default and every route below
organizations Organization[] // via ownerId
```
Tickets and `Payment` rows **stay on `User`**, not `Organization` — a support ticket or a wallet top-up isn't org-specific (confirmed: the wallet is shared across all of a user's orgs).

## Migration — there is real data, this is not a green-field schema change

Confirmed live accounts exist today (`myrate619@gmail.com`, `mymood619@gmail.com`, plus whoever signed up during testing) with real `trmmClientId`/`plan`/`premiumExpiresAt` values that must not be lost. Write this as:
1. A Prisma migration that adds `Organization`, adds the new `User` columns, and adds the new FKs on `Deployment`/`Script`/`DeviceGroup` — but **do not drop the old `User` columns in the same migration**. Land the new columns first, keep the old ones temporarily nullable-compatible.
2. A one-time backfill script (plain Node/tsx script, run manually against the production DB, same pattern as any other one-off migration script already in this codebase) that: for every existing `User` row with a non-null `trmmClientId`, creates one `Organization` row copying over `trmmClientId`/`trmmSiteId`/`plan`/`premiumExpiresAt`/`orgName`→`name`, re-points that user's `Deployment`/`Script`/`DeviceGroup` rows from `userId` to the new `organizationId`, and sets `User.activeOrgId` to the new org's id.
3. **Verify row counts before and after** — count of `Organization` rows created should equal count of `User` rows that had a `trmmClientId` set; count of re-pointed `Deployment`/`Script`/`DeviceGroup` rows should match their pre-migration counts exactly. Don't consider this task done until that verification is a real, run, reported number — not assumed.
4. Only after the backfill is confirmed correct, a **second** migration drops the now-unused old `User` columns (`trmmClientId`, `trmmSiteId`, `plan`, `premiumExpiresAt`, `orgName`).

## Every call site that needs re-pointing (confirmed via grep, not exhaustive by memory — re-grep once you start in case something's been missed)

```
app/admin101/(protected)/payments/page.tsx
app/admin101/(protected)/tickets/[ticketId]/page.tsx
app/admin101/(protected)/tickets/page.tsx
app/api/admin/payments/route.ts
app/api/billing/checkout/route.ts
app/api/device-groups/[groupId]/members/route.ts
app/api/devices/deployments/route.ts
app/api/devices/route.ts
app/api/internal/telegram-device-check/route.ts
app/dashboard/devices/[agentId]/page.tsx
app/dashboard/layout.tsx
app/dashboard/settings/page.tsx
app/dashboard/support/[ticketId]/page.tsx
app/onboarding/page.tsx
lib/agent-route.ts
lib/authz.ts
lib/msi-generator.ts
lib/premium.ts
lib/provision.ts
lib/session-user.ts
```
Each of these currently reads `user.trmmClientId`/`user.plan`/`user.premiumExpiresAt`/`user.orgName` directly — they all need to instead resolve the user's **active** organization first (`db.organization.findUnique({ where: { id: user.activeOrgId } })`, or better, a small helper `getActiveOrganization(user)` in `lib/session-user.ts` that does this once and is reused everywhere) and read the field from there. `lib/onboarding`/`lib/provision.ts`'s TRMM client+site creation logic (today keyed to the user directly) needs to create an `Organization` row instead of setting fields on `User`.

## Org switcher UI

1. A dropdown/menu in `components/shell.tsx`'s header, where `orgName` used to render solo — list the user's organizations by `name`, current active one indicated, click to switch.
2. **Switching**: `PATCH /api/organizations/active` (new route) — sets `User.activeOrgId`, then the client does a full `router.refresh()` so every server component re-reads the newly-active org's data. Keep this simple — no client-side org-scoped state management needed, a refresh is enough given every route above now reads from the DB fresh.
3. **Create new organization**: a "+ New organization" entry in the same switcher — prompts for a name, then runs the same TRMM client+site provisioning already built for the first org during email verification (check `lib/provision.ts` for the existing `createClientWithSite`/`createSite` calls) to create a *new* client+site, wraps it in a new `Organization` row, and switches to it immediately. The existing `vantra-{userId}` internal TRMM slug scheme needs a second axis now that one user can own several clients — e.g. `vantra-{userId}-{orgId}` or similar, just needs to stay a unique, non-customer-facing internal slug per the original v1 design decision (never derive it from the org's own display name).

## Explicitly not in this task (separate, follow-up task)

- Wallet balance, top-up flow, Activate/Renew Premium endpoints, the admin manual-payment-review box, widened free-tier action gating (reboot/shutdown/ping requiring premium) — all of that is a **separate** task that will be handed over once this one is done, since it spends against `Organization.plan`/`premiumExpiresAt` created here but isn't part of this task's scope.
- Whether support tickets should become org-scoped — explicitly left as an open question in the plan, not decided here; tickets stay user-scoped for this task.

## Verification

1. Migration backfill: real row-count verification (see above) on a copy of production data before running against production itself.
2. Every file in the re-pointing list above compiles and behaves identically for a single-org user (the common case today) — a full regression pass of add-device, device list, billing card, settings, tickets, admin payments/tickets pages.
3. Create a 2nd organization on a real test account: confirm a genuinely separate TRMM client+site was created (check TRMM's own admin UI, not just "no error thrown"), confirm devices/scripts/groups created under org A never appear under org B for the same user.
4. Switch between orgs via the new switcher: confirm the device list, billing card, and settings page all correctly re-scope to the newly-active org within one page refresh.
5. A pre-migration existing user's single org (migrated from their old `User` columns) works exactly as before — old devices, old premium status, all intact.
