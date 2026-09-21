# Task 68 — Fix the non-atomic first-org provisioning race in `ensureOrgProvisioned`

**Not governed by `TASK_53_...md`** — this is a general correctness bug in existing provisioning logic, found as a side effect of domain-separation work, not part of the domain-separation feature itself. Pick this up whenever convenient; nothing else in Tasks 59-67 blocks on it.

## What's broken, confirmed live twice on 2026-09-21

`lib/provision.ts`'s `ensureOrgProvisioned` does a plain check-then-create for a user's first org:
```ts
let org = await db.organization.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" } });
if (!org) {
  org = await db.organization.create({ data: { ownerId: user.id, name: "", agentDomainTier: "public" } });
  ...
}
```
This is not atomic — two near-simultaneous requests for the same user (e.g. two browser tabs, a slow first load racing a retry, a poll firing during initial provisioning) can both see "no org yet" and both create one. Confirmed twice, independently, live:
1. Task 60's exempt-owner private-org logic (`ensureExemptPrivateOrg`, same check-then-create shape) produced two duplicate "Private" orgs for `mymood619@gmail.com`, 9ms apart — already handled by disabling that specific call site (see `lib/provision.ts`'s comment above the commented-out call, and the Task 60 file's amendment note). That fix only addressed the exempt-account code path, not this one.
2. **This same shape, in the GENERAL first-org path above**, produced **three** duplicate empty-named orgs for a normal user (`rico@ricos.com.au`) during an unrelated cleanup pass on 2026-09-21 — proving this isn't specific to the exempt-account logic at all, it's the underlying `ensureOrgProvisioned` pattern itself, and it can hit ANY user, including real future customers, not just test accounts.

## The fix

A user is allowed to legitimately have multiple orgs (self-service "+ New organization", admin-granted private orgs) — so a blanket `@@unique([ownerId])` on `Organization` is NOT the right fix, it would break real multi-org support. Pick one of these instead (or propose something better, but it must close the race, not just narrow the window):

1. **A single atomic SQL statement** — `INSERT INTO "Organization" (...) SELECT ... WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "ownerId" = $1)` via `$queryRaw`/`$executeRaw`. This is the cleanest fix with no schema change: the existence check and the insert happen as one atomic database operation, no window for a second request to slip in between.
2. **A claim-lock column on `User`** — e.g. a nullable `User.firstOrgClaimedAt` (or reuse `activeOrgId` itself as the lock target) set via a conditional `UPDATE ... WHERE id = $1 AND <column> IS NULL`, and only proceed to create the org if that update actually affected a row (i.e. this request won the race). Whichever request loses the race just re-reads the now-created org instead of creating a second one.
3. **Serializable transaction with retry** — wrap the check+create in a `db.$transaction(..., { isolation: Prisma.TransactionIsolationLevel.Serializable })`, catch the resulting conflict error, and retry the read (now it'll find the winner's row). More moving parts than option 1 or 2; only pick this if there's a reason the raw-SQL or claim-lock approach doesn't fit.

Whichever approach, this needs a genuine concurrency test, not just "looks right on a single request" — the bug only ever shows up under a real race.

## Verification expected

- Fire two (or more) concurrent requests that both hit `ensureOrgProvisioned` for the same brand-new user (e.g. two parallel `curl`s to whatever route calls it, or a small script using `Promise.all`) and confirm exactly ONE org gets created, not two or three.
- Confirm a user who legitimately creates a second org via "+ New organization" still works completely unchanged — the fix must not accidentally cap a user at one org total.
- Confirm existing users with a normal single first org are completely unaffected — no migration needed, this only changes the creation path's atomicity.
