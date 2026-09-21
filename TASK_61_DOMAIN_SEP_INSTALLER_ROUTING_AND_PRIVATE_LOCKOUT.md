# Task 61 — Domain separation, bit 3: installer routing by tier, AND private orgs get NO installer at all

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 3, **expanded by a new owner requirement (2026-09-21) that Part 3 as originally written does not cover** — read this whole file, not just Part 3, before starting. Depends on Task 59 (schema/env) and Task 60 (provisioning) landing first.

## The new requirement, in the owner's own words

"I will also want the private domain agent part not to allow private org user add device through agent installation, can only add device through powershell commands." A private-tier org must have **no self-service installer generation path at all** — the only way a device joins a private org is via the PowerShell-based move mechanism (Task 62), moving a device that already exists in a public org. This is stricter than Part 3's original framing (which only talked about which `apiUrl` an installer bakes in) — a private org shouldn't be ABLE to generate an installer in the first place.

## Scope — only this

1. **Resolve by tier for the (rare/soon-to-not-exist) case installer generation is still reachable**: every place that currently reads `TRMM_API_BASE_URL` to build an install command (`app/api/devices/deployments/route.ts`, both `apiUrl: env.trmmApiBaseUrl` call sites — grep for every reader, don't rely on memory of exactly two) needs to resolve the CALLING ORG's `agentDomainTier` first, then pick `TRMM_PUBLIC_API_BASE_URL` or `TRMM_PRIVATE_API_BASE_URL`. Get this right even though point 2 below means the private branch should rarely/never actually be hit via self-service — defense in depth, and it's still needed for whatever internal/admin tooling generates a private installer for the PowerShell-provisioning flow itself (Task 62 needs a private-domain install command to exist SOMEWHERE, just not reachable by a private org's own self-service UI).
2. **Block self-service installer generation for private-tier orgs entirely**: wherever the "Add device" / "Generate installer" UI and its backing endpoint(s) currently work for any org, gate them on `org.agentDomainTier === "public"`. A private-tier org's device page should show something like "Private organizations add devices by moving them from a public organization — see [Move device]" instead of an installer/download flow. Gate the ENDPOINT itself (403 for a private org, not just hide the button) — same discipline as every other access gate in this codebase, client-side hiding alone is never sufficient.

## Explicitly NOT in scope here (later tasks)

- Don't build the move mechanism itself yet (Task 62) — this task can reference it as "not yet built" in the private-org UI copy.
- Don't touch UI tier badges yet (Task 65) beyond what's needed to show the "private orgs can't self-install" messaging.

## Verification expected

- A public-tier org's installer generation is completely unchanged — confirm an installer still generates and its baked-in `apiUrl` is `TRMM_PUBLIC_API_BASE_URL`.
- A private-tier org's installer-generation endpoint returns 403 when called directly (not just hidden in the UI) — try calling it directly as a private-org member.
- A private-tier org's device page shows the "add via move, not installer" messaging instead of a working installer flow.
- `npx tsc --noEmit` clean.
