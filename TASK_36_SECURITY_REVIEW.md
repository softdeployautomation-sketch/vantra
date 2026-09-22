# Task 36 — Security review (credential scheduling + unlock flows)

**Status: ready to implement.** Written 2026-09-10 by Cline. Run the review against
the completed feature work (TASK_27, TASK_28, TASK_29, TASK_30, TASK_31, TASK_33)
and fix anything it turns up before the final write-up (TASK_35).

## 1. Authorization (must remain intact)

Confirm all of these still hold after the changes:

- **Staff-only**: only `isStaff` users can see or invoke request-unlock, schedule,
  maintenance, reveal, and callback routes. Non-staff premium users get 404 on
  `request-unlock`, `credential`, `credential/reveal` (existing behavior — verify
  unchanged).
- **Device-level**: `authorizePremiumStaffAgentAction(agentId)` re-checks the caller
  may manage THAT agent on every request. A staff member of org A cannot act on
  org B's device.
- **No customer escalation**: a customer cannot schedule or retrieve credentials
  via any new API route.

## 2. Credential secrecy

- **Passwords are never logged**: no PIN/plaintext in `console.log`, audit, error
  responses, or toast text. The audit layer (`lib/device-credential-audit.ts`)
  only records action/outcome/detail — never the value.
- **At rest**: stored via AES-256-GCM (`lib/credential-crypto.ts`), keyed by
  `CREDENTIALS_ENCRYPTION_KEY`, fail-closed when unset (production key present —
  verified in Task 26 follow-up).
- **Device isolation**: `DeviceCredential` is upserted on `agentId`; reveal reads
  by `agentId`; a Device A credential can never become Device B's.
- **No credential in URLs, browser storage, or localStorage.** The callback posts
  `{token,pin}` over HTTPS; tokens are stored only as SHA-256 hashes and consumed
  once.
- **Scheduled requests** (TASK_27): the pending request row must NOT contain the
  PIN or any plaintext credential — only status/timestamps/token-hash. Confirm the
  schedule path never embeds session/PIN data.

## 3. Callback / token

- One-time token: high-entropy, stored hashed, TTL, consumed on success, nulled on
  supersede. Confirm the new schedule path (TASK_27) mints a token only when it
  actually launches the prompt, and that a schedule with no launch yet has no live
  token.
- The callback cannot be replayed and cannot be triggered without a valid
  non-expired active request (keep `ACTIVE_STATUSES` in sync — see TASK_27 §1).

## 4. New surface

- TASK_27 API additions remain staff+device gated and rate/prompt-safe (do not
  allow mass-scheduling).
- TASK_33 duplicate guard must not be bypassed via the schedule path.
- The PowerShell prompt (TASK_29) still renders only on an existing interactive
  session, does not impersonate Winlogon, and posts only over HTTPS.

## 5. Output

Produce a short security-review section (in the final report or a committed note)
listing each item above with a PASS/FAIL and any compensating control. Fix any FAIL
before merge.