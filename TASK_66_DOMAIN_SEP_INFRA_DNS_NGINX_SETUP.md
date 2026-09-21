# Task 66 — Domain separation, bit 8: infrastructure (DNS, nginx, TRMM ALLOWED_HOSTS)

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 6, which points at the superseded `TASK_52_EXECUTE_DOMAIN_SEPARATION_VANTRA.md`'s Parts 1-3 for the verbatim infra steps — read both. **Blocked on the owner** doing one manual step first (see below) — this can be handed to Cline in parallel with any of Tasks 59-65, it doesn't depend on them, but Cline can't finish it until the owner acts.

## What the owner needs to do first (not Cline's task)

Add two Cloudflare DNS records under the `broks.beauty` zone (account `myrate619@gmail.com`), both **DNS-only / grey-cloud** (not proxied): `agent.broks.beauty` and `dl.broks.beauty`, both A records pointing at `164.68.105.96`.

## Scope — only this (once DNS above exists)

- Confirm DNS propagation.
- Issue TLS certs for the new hostnames (certbot, matching the pattern the existing vhosts already use).
- Add new nginx server blocks for `agent.broks.beauty` (and `dl.broks.beauty` if that's part of this cutover — check TASK_52's original scoping for which hostnames it covered).
- Update TRMM's `ALLOWED_HOSTS` in `/rmm/api/tacticalrmm/tacticalrmm/local_settings.py` to include **both** `api.instaweb.top` AND `agent.broks.beauty` **permanently** (not old+new-during-a-transition — per Task 53, both domains stay forever, there is no decommissioning).
- Run the isolated pre-cutover test using the generator's per-call `apiUrl` override (described in TASK_52's Parts 1-3) BEFORE anything in Tasks 59-64 depends on this domain actually working end-to-end.

## Verification expected

- A manually-constructed install command using `agent.broks.beauty` as its `apiUrl` actually reaches the real TRMM backend and a test agent checks in successfully — prove this in isolation before Task 61/62's code starts relying on it.
- `api.instaweb.top` continues working completely unchanged throughout (existing private-tier traffic, once Tasks 59-63 exist, must never be disrupted by this infra change).
