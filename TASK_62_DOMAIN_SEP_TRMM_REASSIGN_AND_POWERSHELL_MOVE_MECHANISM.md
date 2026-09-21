# Task 62 — Domain separation, bit 4: the underlying move mechanism (TRMM reassign + PowerShell reconfigure)

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 4. This is the SHARED foundation Task 63 (one-click button) and Task 64 (20-min auto-move) both call into — build this as a plain function/module, not tied to any particular UI trigger, so both later tasks can call the same code. Depends on Task 59/60/61 landing first.

## Scope — only this

A device move (public org → private org) is genuinely two separate actions — build and verify both, don't stop at one:

1. **Reassign the device's TRMM client/site** to the destination (private) org's TRMM client/site. `lib/trmm.ts` has no wrapper for this yet (only `createClientWithSite` exists today) — add one. **Verify the exact TRMM REST API endpoint/payload shape against the real running TRMM instance (its OpenAPI schema, usually served at the API root, or the admin UI's own network calls) before writing this — don't guess the endpoint shape**, TacticalRMM's agent-update API has changed across versions before.
2. **Reconfigure the agent itself** (the actual software running on the customer's machine) to call the private hostname going forward. Push a script via the EXISTING run-script capability (`app/api/devices/[agentId]/scripts/[scriptId]/run/route.ts` already exists — reuse it, don't build new remote-execution plumbing) that edits the agent's local config to point at `TRMM_PRIVATE_API_BASE_URL` and restarts the `tacticalrmm` Windows service. **Verify the exact local config file path/format and the correct restart procedure against TacticalRMM's actual agent source/docs before writing this script** — a wrong config key or restart sequence could leave a device unreachable by either domain, which is worse than not building this at all.
3. Wrap both steps as one function (e.g. `moveDeviceToPrivate(agentId, destinationOrgId)` in `lib/trmm.ts` or a new `lib/device-move.ts`) that does step 1, then step 2, and returns a clear success/failure per step — a caller (Task 63's button, Task 64's scheduler) needs to know if it landed in TRMM's admin but the agent-side reconfigure failed (or vice versa), not just an opaque boolean.

## Explicitly NOT in scope here (later tasks)

- No UI, no button, no endpoint exposed to end users yet — that's Task 63.
- No scheduling/auto-trigger logic yet — that's Task 64.

## Verification expected

- Test on a **fully disposable device, never a real one**, until this is proven reliable.
- After calling the function: confirm the device shows under the private org's TRMM client/site in TRMM's own admin (not just Vantra's DB), AND confirm it's still actually online/checking in afterward — both halves, not just one.
- Confirm a failure in step 2 (agent reconfigure) is surfaced distinctly from a failure in step 1 (TRMM reassign) — test by simulating each failure mode if possible.
