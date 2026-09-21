# Task 60 — Domain separation, bit 2: provisioning defaults + admin grant-private action

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 2. Depends on Task 59 (schema) landing first.

**Status: built, committed (`65ff6d0`), deployed. One amendment (2026-09-21, owner request) — read this before touching `lib/provision.ts` again.** The automatic exempt-owner private-org creation (originally called from `ensureOrgProvisioned` on every dashboard load) is now **disabled** (commented out, not deleted). It ran in production and produced two duplicate "Private" orgs for `mymood619@gmail.com` — its `findFirst`-then-`create` check is not atomic, so two near-simultaneous requests both saw "no private org yet" and both created one. Both stray orgs were confirmed to have zero devices/deployments and were deleted. Reasoning for disabling rather than just fixing the race: the private agent domain (Task 66's DNS/nginx/TRMM infra) doesn't exist yet, so auto-creating these orgs right now is premature regardless — they'd be real orgs with no working private domain behind them. **The admin "Grant private organization" button (already built, see below) is now the intended way to create these two orgs — deliberately, once, when Task 66 is actually done** — not automatic reprovisioning. Don't re-enable the commented-out call without either fixing the race (e.g. a DB-level `@@unique([ownerId, agentDomainTier])` constraint, or wrapping the check+create in a transaction) or deciding it's simply not needed given the admin button already covers this.

## Scope — only this

- `lib/provision.ts`'s `ensureOrgProvisioned` (auto-create-first-org on signup): pin `agentDomainTier: "public"` explicitly at the call site (don't rely on the schema default alone).
- ~~**Exactly two accounts** — `myrate619@gmail.com` and `mymood619@gmail.com` — get a SECOND org auto-created too, tier `"private"`, at the same provisioning point.~~ **Superseded by the amendment above — this auto-creation is disabled.** Use the admin grant button instead, whenever Task 66 is actually ready.
- `createOrganizationWithClient` (the existing self-service "+ New organization" button): always creates tier `"public"` — confirm/enforce this explicitly, a regular user must never self-service into a private org.
- New admin action: "Grant private organization" — for a chosen user, creates a NEW `Organization` (not an upgrade of an existing one — the user keeps their public org untouched and gets an ADDITIONAL private one), forced `agentDomainTier: "private"`, admin-session-gated. Same underlying provisioning call as `createOrganizationWithClient`, just forced to private. Put the button in the admin users/orgs page in `/admin101`.

## Explicitly NOT in scope here (later tasks)

- Don't touch installer-generation routing yet (Task 61).
- Don't touch the move mechanism yet (Task 62/63/64).

## Verification expected

- A fresh signup (not one of the two exempt accounts) ends up with exactly one org, tier `public`.
- Signing in as `myrate619@gmail.com` (or a disposable stand-in for `mymood619@gmail.com` if that real account can't be used for testing) shows two orgs, correctly tiered.
- Self-service "+ New organization" still only ever produces `public` orgs — try it as a normal test user and confirm.
- Admin grants a private org to a fresh test user; confirm it appears as a SECOND org for them, and their existing public org/devices are completely untouched.
