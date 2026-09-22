# Task 85 — Retire legacy vhosts + apply the deferred 301s

**Priority: third — BLOCKED by Task 84.** Task 83's sweep proved both legacy
domains carry functional POST traffic from shipped EXEs, so NO redirect may
exist until the repointed/rebuilt EXEs (Task 84) have replaced them and the
old builds are sunset.

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
- [ ] 3. **Old-EXE sunset confirmation** (unblocks the redirects): check the
      EXE activation/audit logs for any recent activity on old builds;
      confirm no active install still POSTs local-db sync or hosted-fetch to
      the legacy hosts (grep recent vantra/spaceworker access logs for
      POSTs). No 301 until this is green.
- [ ] 4. **Deferred 301s from Task 83**: convert `vantra.conf` → 301
      `vantra.spaceworker.top` and the spaceworker.instaweb.top vhost → 301
      `spaceworker.top` (keep the TLS blocks — old EXEs still handshake).
      Pre-flip POST-curl checks (sync + hosted-fetch paths) against both.
- [ ] 5. Cert audit: list which certs back these vhosts; after retirement,
      either delete the lineages or let them lapse (they won't renew without
      vhosts).
- [ ] 6. Retire: remove fully-dead vhosts (`frontend.conf`, `meshcentral.conf`
      if green); `nginx -t` → reload.
- [ ] 7. DNS: lower TTLs a day ahead; then remove the retired A records from
      the instaweb.top zone (owner's zone token).
- [ ] 8. Post-retirement sweep: device checkins green (TRMM access log),
      web app + SpaceWorker site 200 on canonical hosts only, legacy hosts
      serve clean 301s.
- [ ] 9. Record; note anything that still references the dead hosts.

## Rollback

`cp` each removed vhost to `.bak-task85`; vhosts + DNS re-add trivially.

## Sunset-tracking mechanism (set up 2026-09-22)

nginx access_log now tags every request with `$host` (log_format vhost,
backup /root/nginx.conf.bak-task85-log) — from today, legacy-host traffic
is directly measurable:

    awk '{print $1}' /var/log/nginx/access.log* | sort | uniq -c | sort -rn

Retirement gate (updated per owner, 2026-09-22): owner tests the new EXEs
on the VM (skipped for now, will test later) → then watch the $host log for
1–2 weeks → when `vantra.instaweb.top` + `spaceworker.instaweb.top` POST
counts are ~zero (only stragglers/bookmarks), execute the 301s + vhost/DNS
retirement (steps 4–9). NOTE: instaweb.top lineage renewal is fixed
(TASK_87), so there is no hard deadline pressure anymore — the Nov 30 cert
time bomb is defused and retirement can proceed entirely on evidence.

## OWNER DECISION 2026-09-22 — end state changed: NO redirects, hard removal

> "when we are done, i dont want instaweb linked to any public web app, just
> want instaweb and broks for the agent. the public app and web should route
> to vantra.spaceworker for vantra and spaceworker.top for spaceworker..
> not redirecting from instaweb."

Final state (supersedes the 301 plan):

- **instaweb.top = agent infrastructure only**: keep `agent.instaweb.top`,
  `dl.instaweb.top`, `mesh.instaweb.top` (agent infra). NOTHING else serves.
- **broks.beauty = agent infra only** (already true: agent. + dl.).
- **Public web lives ONLY on**: `vantra.spaceworker.top` (Vantra app) and
  `spaceworker.top` (SpaceWorker site).
- **No 301s from instaweb.** The `vantra.instaweb.top` (vantra.conf) and
  `spaceworker.instaweb.top` vhosts get REMOVED (vhost deleted, DNS A
  records removed), not redirected. Old EXEs that call them will simply
  fail — acceptable per owner; the sunset-traffic measurement (above) is
  still the evidence gate, but the end state is deletion, not redirect.
- Keep serving the `instaweb.top` lineage cert for the remaining
  agent-infra hostnames (or issue a narrower lineage at retirement time if
  the wildcard is dropped).

Execution order unchanged otherwise: old-EXE sunset evidence → delete
`vantra.conf` + `spaceworker.instaweb.top` vhost → remove DNS records →
agent sweep for `rmm.instaweb.top` → retire `frontend.conf`/legacy → verify.
