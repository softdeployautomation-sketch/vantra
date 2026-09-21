# Task 63 — Domain separation, bit 5: the manual "move device" button

**Governed by**: `TASK_53_PUBLIC_PRIVATE_AGENT_DOMAINS.md` Part 4's access rules. Depends on Task 62's `moveDeviceToPrivate()` (or equivalent) already existing — this task is purely the UI + endpoint wrapping it.

## Scope — only this

- A "Move to private organization" button on a device's page/row, calling a new endpoint that invokes Task 62's move function.
- **Access** (confirmed with the owner earlier this session, unchanged): both admin (any device, any org) and an org owner who already has both a public and a private org (their own devices, between their own two orgs) can trigger a move. A public-only user has no private org to move a device INTO, so the button is naturally unavailable to them without needing separate gating logic — just render/hide the button based on whether the acting user's account actually has a private org available as a destination.
- **Gate the endpoint itself** on "caller is admin OR caller owns a private org that is the actual destination" — client-side hiding alone is never sufficient. The underlying mechanism must never be triggerable by a plain public-tier user for a public-tier destination — it only ever exists as a way OUT of public into private, never used casually.
- Surface the two-step success/failure Task 62's function returns (TRMM reassign vs. agent reconfigure) as distinct, readable UI states — don't collapse them into one generic "failed" message if the underlying function already distinguishes them.

## Verification expected

- A disposable test device, freshly installed against the PUBLIC domain, gets moved via this button; confirm (a) it shows under the private org's client/site in TRMM's own admin, AND (b) it's still actually online/checking in.
- Confirm a public-tier-only test user genuinely cannot trigger a move — call the endpoint directly (not through the UI), confirm it's rejected.
- Confirm an admin can move ANY device regardless of org ownership.
