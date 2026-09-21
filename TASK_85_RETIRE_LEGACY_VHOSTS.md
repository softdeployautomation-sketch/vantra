# Task 85 — Retire legacy vhosts (old instaweb.top family)

**Priority: third — BLOCKED by Task 84** (old EXEs must be off the legacy
hosts, or rebuilt+redistributed, before these vhosts die).

## Legacy hosts currently serving (verified 2026-09-22)

- `vantra.instaweb.top` — old Vantra app copy (`vantra.conf`; becomes a 301
  in Task 83)
- `spaceworker.instaweb.top` — old SpaceWorker site copy (becomes a 301 in
  Task 83)
- `rmm.instaweb.top` (`frontend.conf`) — OLD TRMM API base; agents still
  pointed here? WilksF9 was migrated to api.spaceworker.top (Task 82), but
  sweep ALL agents first.
- `mesh.instaweb.top` — legacy MeshCentral front; check whether the new TRMM
  still routes mesh through it.

## Checklist

- [ ] 1. **Agent sweep**: query TRMM for any agent whose BaseURL/ApiURL
      registry still says `rmm.instaweb.top` (raw-cmd reg query across
      agents, or TRMM DB). Migrate stragglers with the Task 62 move cmd
      (expect the known 400-on-restart quirk).
- [ ] 2. MeshCentral check: confirm the new TRMM's mesh route doesn't point
      agents at mesh.instaweb.top; if it does, migrate that setting first.
- [ ] 3. Cert audit: list which certs back these vhosts; after retirement,
      either delete the lineages or let them lapse (they won't renew without
      vhosts).
- [ ] 4. Retire: remove `vantra.conf`/`spaceworker.instaweb.top` vhosts (if
      Task 83 chose full retirement over 301) and `frontend.conf` +
      `meshcentral.conf` if green; `nginx -t` → reload.
- [ ] 5. DNS: lower TTLs a day ahead; then remove the retired A records from
      the instaweb.top zone (owner's zone token).
- [ ] 6. Post-retirement sweep: device checkins green (TRMM access log),
      web app + SpaceWorker site 200 on canonical hosts only.
- [ ] 7. Record; note anything that still references the dead hosts.

## Rollback

`cp` each removed vhost to `.bak-task85`; vhosts + DNS re-add trivially.
