# Task 53 — Public/private agent domains as a permanent, org-scoped architecture

**Status: ready to build. Owner-requested 2026-09-21, urgent — must land before other customers onboard on Vantra.** Supersedes `TASK_52_EXECUTE_DOMAIN_SEPARATION_VANTRA.md`'s straight swap-and-decommission approach — that file's verified technical facts (TRMM's `ALLOWED_HOSTS` gap, the generator's per-call `apiUrl` override, the shared-Cloudflare-account note) still apply and are reused below; only the shape of the change is different.

## The design, in the owner's own framing

Instead of migrating everyone off `api.instaweb.top` onto `agent.broks.beauty`, run BOTH permanently:

- **`agent.broks.beauty`** — the **public** agent domain. Every new signup's default org uses this. If it ever gets reputation-flagged, only public-org devices are affected.
- **`api.instaweb.top`** — becomes the **private** agent domain, kept permanently (not decommissioned). Admin-granted only — not self-service.

This reuses Vantra's EXISTING multi-org support (a user can already self-service-create a second org via "+ New organization," confirmed live in `lib/provision.ts`'s `createOrganizationWithClient`) rather than building new plumbing for "having two of something." The only genuinely new concept is which AGENT DOMAIN an org is tied to.

**One architectural point worth stating explicitly since it makes the whole thing much simpler than it might sound**: public and private are two HOSTNAMES in front of the SAME TacticalRMM backend/database (exactly like `dl.instaweb.top`/`agent.broks.beauty` already proxy to the same generator/TRMM service from two different hostnames elsewhere in this plan) — not two separate RMM stacks. "Moving" a device between them is a config change (which URL the agent calls + which TRMM client/site it's filed under), not a reinstall or a data migration between databases.

## Part 1 — schema

- `Organization.agentDomainTier String @default("public")` — values `"public"` / `"private"`. This is the field that decides which `TRMM_API_BASE_URL`-equivalent an org's installers get.
- Two backend config values now, not one (env vars, matching the existing pattern): `TRMM_PUBLIC_API_BASE_URL=https://agent.broks.beauty`, `TRMM_PRIVATE_API_BASE_URL=https://api.instaweb.top`. The single `TRMM_API_BASE_URL` this session's earlier plan assumed gets replaced by these two — audit every current reader of `TRMM_API_BASE_URL` (`lib/env.ts`, `app/api/devices/deployments/route.ts`, anywhere else — grep for it) and resolve the right one per-org instead.

## Part 2 — provisioning defaults (confirmed with the owner, don't re-derive)

- **Every new account** gets exactly one org auto-created on signup, tier `"public"` — this is `ensureOrgProvisioned`'s existing auto-create-first-org behavior (`lib/provision.ts`), just pin the new field explicitly rather than relying on the schema default alone (be explicit at the call site, not implicit).
- **Exactly two accounts** — `myrate619@gmail.com` and `mymood619@gmail.com` — get a SECOND org auto-created too, tier `"private"`, at the same provisioning point. Hardcode this as an explicit email allowlist check inside `ensureOrgProvisioned` (or wherever it's cleanest), not a config flag — these are the owner's own accounts, not a generalizable feature.
- **Self-service "+ New organization"** (`createOrganizationWithClient`, the existing "+ New organization" button) always creates tier `"public"` — a regular user must never be able to self-service their way into a private org.
- **New admin action**: "Grant private organization" — for a chosen user, creates a NEW Organization (not an upgrade of an existing one — a user keeps their public org and gets an ADDITIONAL private one, so their existing public devices are untouched) with tier `"private"`, same underlying provisioning call as `createOrganizationWithClient` but forced to `"private"` and admin-session-gated. Put it in the admin users/orgs page (Users tab or wherever orgs are currently listed in `/admin101`).

## Part 3 — installer generation routes by org tier

Every place that currently reads `TRMM_API_BASE_URL` to generate an install command (`app/api/devices/deployments/route.ts`, both `apiUrl: env.trmmApiBaseUrl` call sites) needs to resolve the CALLING ORG's `agentDomainTier` first, then pick `TRMM_PUBLIC_API_BASE_URL` or `TRMM_PRIVATE_API_BASE_URL` accordingly. This is the one piece that makes "which domain an org uses" actually take effect — get this wrong (e.g. leave a stale reference to the old single env var anywhere) and an org's installers silently keep using the wrong domain.

## Part 4 — the device move mechanism (public org → private org)

This is genuinely two separate actions that both need to happen for a move to be complete — don't build only one and assume it's done:

1. **Reassign the device's TRMM client/site** to the destination (private) org's TRMM client/site. TRMM's own REST API supports updating an agent's client/site assignment (standard RMM admin operation) — `lib/trmm.ts` has no wrapper for this yet (only `createClientWithSite` exists today); add one. **Verify the exact TRMM API endpoint/payload shape against the real running TRMM instance's API (or its OpenAPI schema, usually served at the API root) before writing this — don't guess the endpoint shape.**
2. **Reconfigure the AGENT ITSELF** (the actual software already running on the customer's machine) to call the private hostname instead of public going forward — this is what makes the device actually reachable/functional after the move, not just correctly labeled in TRMM's admin. This needs a script pushed via TRMM's EXISTING run-script capability (`app/api/devices/[agentId]/scripts/[scriptId]/run/route.ts` already exists — reuse it, don't build new remote-execution plumbing) that edits the agent's local config to point at the new API host and restarts the `tacticalrmm` Windows service. **Verify the exact local config file path/format and the correct restart procedure against TacticalRMM's actual agent documentation/source before writing this script — a wrong config key or restart sequence could leave a device unreachable by either domain**, which is a worse outcome than not building this at all. Test on a fully disposable device, never a real one, until this is proven reliable.

**Access** (confirmed with the owner): both admin (any device, any org) and an org owner who already has both a public and a private org (their own devices, between their own two orgs) can trigger a move. A public-only user has no private org to move a device INTO, so the button is naturally unavailable to them without needing separate gating logic — just render/hide the button based on whether the acting user's account actually has a private org available as a destination.

**"Not available to the public"**: the underlying mechanism (the reassignment API call + the reconfigure script) must never be triggerable by a plain public-tier user for a public-tier destination — it only ever exists as a way OUT of public into private, never used casually. Gate the endpoint itself (not just hide the button) on "caller is admin OR caller owns a private org that is the actual destination" — client-side hiding alone is never sufficient.

## Part 5 — UI: show the tier, don't hide it

Wherever the org switcher renders org names (`components/workspace-shell.tsx`, confirmed as an existing `instaweb.top`-referencing file this session, likely also where org switching UI lives — check for the actual org-list component), add a small "Public" / "Private" badge next to each org's own custom name. This is a simple, low-risk addition — do it early, it's useful for every other part of this task's own testing too (you'll want to SEE which tier you're looking at while building/testing the rest of this).

## Part 6 — infrastructure (unchanged from Task 52, still needed)

Everything in the superseded `TASK_52_EXECUTE_DOMAIN_SEPARATION_VANTRA.md`'s Parts 1-3 still applies exactly as written: the owner's manual Cloudflare DNS records, DNS propagation check, TLS cert issuance, the two new nginx server blocks, TRMM's `ALLOWED_HOSTS` update (now needs BOTH `api.instaweb.top` AND `agent.broks.beauty` permanently, not old+new-during-transition — they're both staying forever now), and the isolated pre-cutover test using the generator's per-call `apiUrl` override. Follow that file's Parts 1-3 verbatim; only Part 4 onward (the `.env` cutover and decommissioning) is replaced by this file's Parts 1-5 above — there is no decommissioning anymore, both domains are permanent.

## Verification expected

- `npx tsc --noEmit` clean; migration applied for the new `Organization.agentDomainTier` column.
- A fresh signup (not one of the two exempt accounts) ends up with exactly one org, tier `public`, installers from it use `agent.broks.beauty`.
- Signing in as `myrate619@gmail.com` (or a disposable stand-in for `mymood619@gmail.com` if that real account can't be used for testing) shows two orgs, correctly tiered, both visibly badged.
- Admin grants a private org to a fresh test user; confirm it appears as a second org for them, correctly badged, and their EXISTING public org/devices are untouched.
- A disposable test device, freshly installed against the PUBLIC domain, gets moved to a private org via the new button; confirm (a) it now shows under the private org's client/site in TRMM's own admin, AND (b) it's still actually online/checking in — both halves of Part 4, not just one.
- Confirm a public-tier-only test user genuinely cannot trigger a move (endpoint-level check, not just UI hiding — try calling it directly).
