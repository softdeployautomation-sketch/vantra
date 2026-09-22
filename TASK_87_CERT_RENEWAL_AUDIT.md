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

## Audit results (DONE 2026-09-22 — all 6 lineages pass dry-runs)

| Lineage | Expiry | Auth | Credentials INI | Dry-run | Hook |
|---|---|---|---|---|---|
| agent-instaweb-top | 2026-12-20 | dns-cloudflare | cloudflare-instaweb.ini | ✅ (1 transient API reset, retry passed) | ✅ added |
| broks.beauty-wildcard | 2026-12-20 | dns-cloudflare | cloudflare.ini (broks-scoped token, works) | ✅ | ✅ added |
| **instaweb.top** | 2026-11-30 | dns-cloudflare | **FIXED: was cloudflare.ini (broks token — zone_id lookup FAILED for instaweb.top zone!) → now cloudflare-instaweb.ini** | ✅ after fix | ✅ added |
| broks.beauty (agent.+dl.) | 2026-12-20 | webroot | webroot_map | ✅ (1 rate-limit, retry passed) | ✅ added |
| spaceworker-top | 2026-12-20 | webroot | webroot_map | ✅ | ✅ added |
| api-spaceworker-top | 2026-12-20 | webroot | webroot_map | ✅ | ✅ added |

certbot.timer: 2×/day ✅ (last 02:54, next 15:41).

### Two real defects found & fixed

1. **instaweb.top lineage could not renew** — its credentials INI was the
   broks-scoped `cloudflare.ini` token, which cannot see the instaweb.top
   zone (`Unable to determine zone_id`). Consequence if unfixed: EVERY
   legacy instaweb.top host AND `dl.instaweb.top` (the live download host,
   still referenced by the web app's EXE_DOWNLOAD_URL) would break
   **2026-11-30**. Fixed by pointing the lineage at the instaweb-zone token
   `cloudflare-instaweb.ini` (same one that issued agent-instaweb-top);
   dry-run now passes. Backup: /root/instaweb.top.conf.bak-task87.
2. **No renew_hook on any lineage** — a successful renewal would have
   replaced the cert files while nginx kept serving the stale in-memory
   cert indefinitely. Added `renew_hook = systemctl reload nginx` to all 6
   lineages (initially appended into the wrong INI section for webroot
   lineages — caught and repositioned into [renewalparams]; post-edit
   dry-runs re-verified parse+success).

Notes: cloudflare-spaceworker.ini exists but nothing references it (left
over from Tasks 79/81 — harmless, keep for future). Backups of all modified
renewal confs: /root/<cert>.conf.bak-task87.
