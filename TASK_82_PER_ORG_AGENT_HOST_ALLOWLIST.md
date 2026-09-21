# Task 82 — Per-Org Public Agent-Host Allowlist (code build)

Owner decision (recorded in 55d0efe): **allowlist model** —
`Organization.agentApiHosts: string[]` (stored as a comma/space-separated
TEXT column), per-install host pick in the Add Device flow, and the download
host keyed to the chosen agent host's domain family
(broks → `dl.broks.beauty`, instaweb/private → `dl.instaweb.top`).

## What shipped

- **Prisma**: `Organization.agentApiHosts` (TEXT, default `"agent.broks.beauty"`),
  `Deployment.agentApiHost` (nullable — which host that install was minted for).
  Migration `20260921000000_add_org_agent_api_hosts` (two plain ADD COLUMNs).
  Backfill = the column default (all pre-Task-82 public orgs → broks only).
- **`lib/agent-domains.ts`**: `PUBLIC_AGENT_API_HOSTS` (broks, instaweb),
  `parseAgentApiHosts(raw, tier)` (validated parse; private orgs always the
  single private host; empty/unknown → broks default), and
  `resolveAgentApiBaseUrlForHost(tier, host)` (unknown host fails closed to
  `TRMM_PUBLIC_API_BASE_URL`). `TRMM_INSTAWEB_API_BASE_URL` env (optional,
  default `https://agent.instaweb.top`).
- **`lib/installer-download-host.ts`**: `resolveInstallerDownloadHostForAgentHost`
  (broks → dl.broks.beauty; instaweb/unknown → undefined = generator default
  dl.instaweb.top) and `rewriteInstallerDownloadUrl(url, tier, agentHost?)` —
  instaweb-family installs are never rewritten.
- **POST /api/devices/deployments**: optional `agentHost` field (JSON or
  multipart). Server-side gate: chosen host must be in the org's parsed
  allowlist, else 400; absent → first allowed host (byte-identical to
  pre-Task-82 behavior). Private orgs remain 403 (Task 61 lockout unchanged).
- **GET /api/devices**: now returns `agentApiHosts` (the parsed allowlist).
- **Add Device modal** (inline + page): "Agent server" picker rendered only
  when the allowlist has >1 entry; sends `agentHost` on both JSON and MSI
  multipart paths.
- **Admin**: PATCH `/api/admin/organizations/[orgId]/agent-hosts` (public orgs
  only; validates against the known set; private → 409) + checkbox editor with
  Save in the admin user detail orgs table ("Agent hosts" column; private orgs
  show "private host (fixed)").

## Validation

- `npx tsc --noEmit` clean; eslint clean on all touched files.
- Pure-function sanity: 11 assertions over
  parse/resolve/download-host/rewrite (broks/instaweb/private/unknown),
  all matching spec (see session log).
- **Deployed + live E2E verified 2026-09-21** (`9b36c2b`, deployed to
  /opt/vantra, migration applied after pg_dump backup
  `/root/vantra-db-backup-20260921-task82.sql`, `prisma migrate deploy` →
  `generate` → build → `vantra.service` restart, all green):
  - Admin PATCH granting `blast` both hosts → `{"ok":true, 2 hosts}`;
    GET /api/devices returns `agentApiHosts: [broks, instaweb]`.
  - ZIP POST **without** `agentHost` → `dl.broks.beauty` download URL,
    `Deployment.agentApiHost = agent.broks.beauty` (byte-identical legacy).
  - ZIP POST with `agentHost: agent.instaweb.top` → `dl.instaweb.top`
    download URL (no rewrite), `Deployment.agentApiHost = agent.instaweb.top`.
  - ZIP POST with `agentHost: evil.example` → **400** "not an allowed agent
    host".
  - Private org (Sc01t): admin edit → **409**; customer ZIP POST → **403**
    (Task 61 lockout intact; the minted-session run accidentally proved this
    first — activeOrg resolved to the private org).
  - Cleanup: test deployments deleted, blast allowlist restored to default,
    `activeOrgId` restored to Sc01t.

## Deploy notes (done)

1. Apply migration on the VPS DB (`prisma migrate deploy`) as part of the
   standard rsync → build (`sudo -u vantra`) → `systemctl restart vantra.service`.
2. Optional: set `TRMM_INSTAWEB_API_BASE_URL` in `/opt/vantra/.env` (defaults
   to `https://agent.instaweb.top`, which is already live).
3. E2E per HOW_WE_MOVE_FAST.md: mint one broks-install and one
   instaweb-install ZIP through the deployed route; confirm the per-install
   download host follows the chosen family; confirm a tampered `agentHost`
   (not in allowlist) gets 400.
