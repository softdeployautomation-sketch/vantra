# Task 59 — Domain separation, bit 1: schema + env vars

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` (the full design doc — read that first for the "why"; `TASK_52_...md` is superseded, ignore it). This is Part 1 of that doc, split into its own file so it can be handed to an agent on its own.

## Scope — only this

- `prisma/schema.prisma`: add `Organization.agentDomainTier String @default("public")` (values `"public"` / `"private"`).
- Two new env vars, replacing the single `TRMM_API_BASE_URL` this session's earlier draft assumed: `TRMM_PUBLIC_API_BASE_URL=https://agent.broks.beauty`, `TRMM_PRIVATE_API_BASE_URL=https://api.instaweb.top`.
- Migration file for the schema change.
- `npx tsc --noEmit` clean, `npx prisma generate` run locally so the new field's types exist for later tasks to build against.

## Explicitly NOT in scope here (later tasks)

- Don't touch any reader of the old `TRMM_API_BASE_URL` yet (Task 61 does that).
- Don't touch provisioning defaults yet (Task 60).
- Don't add the DNS/nginx infra yet (Task 66).

## Verification expected

- Migration applies cleanly against the live DB (`npx prisma migrate deploy` on the VPS, per `HOW_MOVE_FAST.md`'s migrate→generate→build→restart order if this repo has one, else the equivalent SpaceWorker playbook pattern).
- Existing orgs all read back `agentDomainTier: "public"` (the default) with no manual backfill needed.
