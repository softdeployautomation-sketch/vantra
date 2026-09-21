# Task 87 — Cert renewal audit (all new lineages)

**Priority: time-based (before the next renewal cycle); independent.**

## Lineages in play (post Task 79/81/82)

- `spaceworker-top` — webroot (vantra.spaceworker.top + spaceworker.top)
- `agent-instaweb-top` — DNS-01 (cloudflare-instaweb.ini)
- `broks.beauty-wildcard` — DNS-01 (per-zone cloudflare INIs)
- Pre-existing: whatever backs rmm.conf / api-spaceworker.conf / dl hosts

## Checklist

- [ ] 1. `certbot certificates` on the VPS: list every lineage, expiry, and
      renew config; flag any lineage whose renew hook references the old
      global cloudflare ini (`cloudflare-spaceworker.ini`) vs the per-zone
      INIs — make sure each DNS-01 lineage points at a zone-scoped token
      file that exists.
- [ ] 2. `certbot renew --dry-run` for EACH lineage individually (not just a
      blanket dry-run); record pass/fail per lineage.
- [ ] 3. Confirm the systemd timer/cron for renew is active and the
      deploy-hooks reload nginx (and rmm.service for TRMM hosts if needed).
- [ ] 4. Check cert file paths referenced in every enabled vhost resolve to
      real lineage files (a renamed lineage = broken reload after expiry).
- [ ] 5. Record a lineage→zone-ini→vhost table in this doc for future tasks.

## Rollback

Audit-only task; no changes unless a lineage is found broken — fix per
lineage with the same DNS-01 procedure used in Task 79/82.
