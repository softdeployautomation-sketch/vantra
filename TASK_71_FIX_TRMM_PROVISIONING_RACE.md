# Task 71 — Fix the TRMM-provisioning race left over after Task 68's DB-row fix

**Confirmed live 2026-09-21** while verifying Task 68 (which fixed a DIFFERENT race — duplicate `Organization` rows). Task 68's fix is genuinely correct: a controlled test firing 2 concurrent `ensureOrgProvisioned(userId)` calls for the same brand-new user produced exactly **1** org row, every time. But that same test exposed a second, still-open race in the code immediately after it.

## What's broken, reproduced directly against production `lib/provision.ts`

```
call 0: ok, org=cmub9orl00002kp8ck7psymcn, client=30, site=115
call 1: REJECTED - TRMM 400: {"name":["client with this name already exists."]}
actual org rows in DB for this user: 1 [ { id: '...', client: 30, site: 115 } ]
```

`ensureOrgProvisioned`'s tail (unchanged by Task 68 — this is the part AFTER the org row is resolved):
```ts
if (!org.trmmClientId || !org.trmmSiteId) {
  await provisionOrganization(org.id, clientNameFor(org));
  ...
}
```
Two concurrent calls that both resolve to the SAME org row (correctly, thanks to Task 68) can both read `trmmClientId: null` before either has finished provisioning it. Both then call `provisionOrganization` → `createClientWithSite` → TRMM's client-create endpoint with the SAME client name. TRMM itself enforces name uniqueness, so the loser gets a hard `400 client with this name already exists` — which `ensureOrgProvisioned` does not catch, so it propagates as a thrown error all the way to the caller. In production this means: two near-simultaneous requests for the same freshly-created (but not-yet-TRMM-provisioned) org — e.g. two browser tabs on first dashboard load — and one of them gets a real error/failed page load, even though the org data itself is fine and singular.

**This is not data corruption** (confirmed: exactly one org row, one real TRMM client/site) — it's a request-level failure for the loser of the race.

## The fix

Do NOT re-architect this like Task 68's DB lock (a `SELECT ... FOR UPDATE` doesn't help here — TRMM is an external HTTP API, not a row Postgres can lock). Instead, make the loser recover gracefully. Two viable approaches:

1. **Catch-and-reload**: wrap the `provisionOrganization` call in a try/catch. On failure, re-fetch the org from the DB — if `trmmClientId`/`trmmSiteId` are now populated (someone else won the race and already wrote them back), use that instead of re-throwing. Only propagate the error if the org STILL isn't provisioned after the re-fetch (a genuine failure, not a race loss).
2. **Same row-level lock, extended scope**: reuse Task 68's `FOR UPDATE` transaction, but hold it (or a second short lock) across the TRMM provisioning + the DB write-back of `trmmClientId`/`trmmSiteId`. This closes the window more completely but re-introduces the exact risk Task 68's own comment warned against ("never hold the DB lock across a slow network call") — prefer option 1 unless there's a concrete reason it doesn't fit.

Whichever approach: reuse `provisionOrganization`/`createClientWithSite` (`lib/trmm.ts`) as-is — this is about handling ITS failure gracefully, not changing how a client gets created.

## Verification expected

- Re-run the exact test that found this (or equivalent): fire 2+ concurrent `ensureOrgProvisioned` calls for the same brand-new user. Confirm BOTH calls now resolve successfully (not just one), both returning the SAME org with the SAME populated `trmmClientId`/`trmmSiteId` — no thrown error on the loser.
- Confirm still exactly one `Organization` row and one real TRMM client/site (Task 68's guarantee must not regress).
- A genuine TRMM outage (not a race, a real failure) must still surface as an error — don't swallow real failures while fixing the race-loss case.
