# Task 86 — broks.beauty apex — CLOSED (owner decision: leave as-is)

**Owner decision 2026-09-22:** "broks.beauty is just for the second public
agent, nothing more." No apex vhost, no redirect, no page. The bare-domain
520 is accepted and documented — it is cosmetic (nothing directs anyone to
the bare domain; all broks.beauty usage is `agent.` / `dl.` subdomains).

## Recorded facts

- `https://broks.beauty/` → Cloudflare 520 (no origin apex vhost). Pre-existing
  since before Task 79; not a regression.
- broks.beauty purpose per owner: **second public agent family only** —
  `agent.broks.beauty` (TRMM public API) + `dl.broks.beauty` (installer
  downloads). Both live and verified (Task 82 E2E).
- No work needed. Do not "fix" the 520 later without owner sign-off.

No checklist, no rollback — decision-only task.
