# Task 60 — Domain separation, bit 2: provisioning defaults + admin grant-private action

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 2. Depends on Task 59 (schema) landing first.

## Scope — only this

- `lib/provision.ts`'s `ensureOrgProvisioned` (auto-create-first-org on signup): pin `agentDomainTier: "public"` explicitly at the call site (don't rely on the schema default alone).
- **Exactly two accounts** — `myrate619@gmail.com` and `mymood619@gmail.com` — get a SECOND org auto-created too, tier `"private"`, at the same provisioning point. Hardcode as an explicit email allowlist check inside `ensureOrgProvisioned` (or the cleanest nearby spot) — these are the owner's own accounts, not a generalizable feature, don't build a config flag for it.
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
