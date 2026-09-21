# Task 67 — Migrate existing devices off api.instaweb.top onto agent.broks.beauty

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` (the design doc) + `TASK_62_DOMAIN_SEP_TRMM_REASSIGN_AND_POWERSHELL_MOVE_MECHANISM.md` (the mechanism this task reuses). **Hard dependencies — do not start until both are true**: Task 62's agent-reconfigure-and-restart script exists and is proven on a disposable device, AND Task 66's infra is live (`agent.broks.beauty` actually resolves, has a working TLS cert, and TRMM's `ALLOWED_HOSTS` includes it) — confirmed via Task 66's own isolated pre-cutover test, not assumed.

## Why this task exists (owner question, 2026-09-21)

Task 59's migration tagged all pre-existing organizations `agentDomainTier: "public"` (backfilled, no manual work needed — confirmed live: 12/12 existing orgs read back `"public"`). But that tag only controls what NEW installers for that org bake in going forward (Task 61) — it does nothing to the devices that were ALREADY installed before any of this existed. Those devices are still physically calling `api.instaweb.top`, because that's the URL baked into the installer they originally ran, and nothing about the org's DB tag changes a running agent's own local config.

This matters more than a labeling mismatch: the entire point of the public/private split is that `api.instaweb.top` stays a small, protected, admin-only surface — reputation risk from bulk public-tier traffic should land on `agent.broks.beauty` instead, never on the private domain. If existing (public-tagged) customers' devices are left calling `api.instaweb.top` indefinitely, that domain keeps carrying exactly the bulk traffic it was supposed to be isolated FROM, and the whole architecture doesn't actually deliver its stated goal for anyone onboarded before this work started.

**Scope, checked live 2026-09-21**: small — `lib/trmm.ts`'s `listAgents()` currently returns **5** real TRMM agents total, across 14 orgs (most orgs have zero devices — test/empty orgs from earlier session work). This is a handful of devices, not a fleet — do this carefully and mostly by hand, not as an unattended bulk job.

## Scope — only this

For every currently-registered TRMM agent belonging to a `"public"`-tier organization (which today is effectively all of them — no `"private"` orgs currently exist, per the Task 60 amendment):

1. **Do NOT reassign the TRMM client/site** — unlike Task 62's public→private move, these devices' `Organization` row is already correct (`"public"`, unchanged). Only the AGENT'S OWN local config (which URL it calls) needs to change. Reassigning client/site here would be pointless churn and a needless risk.
2. **Reuse Task 62's agent-side reconfigure-and-restart script** (the one that edits the agent's local config to point at a new API host and restarts the `tacticalrmm` Windows service), pointed at `TRMM_PUBLIC_API_BASE_URL` instead of the private one. Push it via the same existing run-script capability (`app/api/devices/[agentId]/scripts/[scriptId]/run/route.ts`) Task 62 already reuses — don't build new remote-execution plumbing here either.
3. **One device at a time, not a bulk blast.** Given the small count: migrate one, confirm it's still checking in on the new domain (both TRMM-admin-visible AND actually online — same two-part verification bar Task 62 uses), THEN move to the next. A script that fires at all 5 unattended and only checks afterward risks silently stranding a real customer's device if something about the config format is subtly wrong on their exact Windows version.
4. **Know the rollback**: before touching each device, note its current config value (still pointing at `api.instaweb.top`) so if the switch fails to bring it back online, the same script can be re-run pointed at the OLD url to revert — don't leave a device stuck mid-migration with no way back.
5. **This is a one-time backfill, not an ongoing job.** Once these 5 (or however many exist by the time this runs) are migrated, this task is done — it does not need a scheduler, a sweep, or to run again for devices installed after Task 61 landed (those already get the correct domain from day one).

## What NOT to do here

- Don't touch `api.instaweb.top` itself (nginx, TRMM `ALLOWED_HOSTS`, certs) — that domain stays live permanently as the private tier, Task 66 already handles its infra.
- Don't grant anyone a private org as part of this — this task only ever moves existing public-tagged devices onto the public domain, it has nothing to do with the private tier.
- Don't automate this into Task 64's 20-minute auto-move sweep — that sweep is specifically for NEW devices moving public→private on a fresh org's opt-in, a completely different direction and trigger than this one-time legacy backfill.

## Verification expected

- Before starting: list the exact devices to be migrated (agent id, hostname, current org) so there's a checklist to work through and confirm nothing was missed or double-run.
- After each device: confirm in TRMM's own admin that it's still checking in, AND confirm via the same live-online check Task 62 uses — not just "the script exited 0."
- After all are done: confirm `agent.broks.beauty` is now the ONLY domain any currently-active device calls (spot-check via TRMM's agent detail or a fresh check-in log), with `api.instaweb.top` no longer carrying any of this traffic.
