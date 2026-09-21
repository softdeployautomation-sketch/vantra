# PLAN — spaceworker.top family consolidation (Tasks 83–87)

**Written 2026-09-22.** Post-migration cleanup plan. The target state is
already live (verified 2026-09-22):

| Host | Role | State |
|---|---|---|
| spaceworker.top | SpaceWorker main website | live |
| vantra.spaceworker.top | Vantra web app (APP_BASE_URL + MSI_GENERATOR_URL) | live |
| agent.broks.beauty / agent.instaweb.top | TRMM public agent API (per-org allowlist, Task 82) | live |
| api.spaceworker.top | TRMM private agent API | live |
| dl.broks.beauty / dl.instaweb.top | installer download hosts (family-keyed) | live |

This plan retires the legacy domains in dependency order. **Triage one task at
a time; each task doc has its own checklist and rollback.** Order matters:
the EXE rebuild (84) unblocks the legacy-vhost retirement (85).

- **TASK_83** — Redirect policy: **SWEEP DONE 2026-09-22, verdict = blocked**.
  Both legacy domains carry functional POST traffic from shipped desktop EXEs
  (`local-db/sync.ts` → vantra.instaweb.top; `hosted-fetch.ts` →
  spaceworker.instaweb.top); a 301 turns POST→GET and would break them. The
  301s are deferred to Task 85, gated on the EXE rebuild + old-EXE sunset.
  Nothing changed on the VPS.
- **TASK_84** — EXE rebuild: now ALSO includes the full code repoint of all
  hardwired legacy-host constants (vantra ×8, spaceworker ×3) BEFORE the EXE
  rebuild, since rebuilt EXEs must carry the new hosts anyway.
- **TASK_85** — Retire legacy vhosts (vantra.instaweb.top,
  spaceworker.instaweb.top, rmm.instaweb.top, mesh.instaweb.top) once nothing
  depends on them; keep certs renewing until removed.
- **TASK_86** — broks.beauty apex: **CLOSED 2026-09-22** — owner decision:
  broks.beauty is for the second public agent only, nothing more; the bare-
  domain 520 is accepted and documented. No work.
- **TASK_87** — Cert renewal audit: confirm all new lineages
  (spaceworker-top, agent-instaweb-top, wildcard broks) renew cleanly in the
  next cycle; document the per-zone cloudflare INIs.

Standing rule: every vhost change keeps the `reuseport` discipline (only one
443 `listen ... reuseport` server-wide) and gets a rollback copy before edit.
