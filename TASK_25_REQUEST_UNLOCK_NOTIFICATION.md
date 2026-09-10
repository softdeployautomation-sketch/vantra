# Task 25 — Staff-only device unlock & credential request (Windows)

**Status: implemented.** Updated 2026-09-10 to the approved direction.

## What this is

A staff-only, **device-scoped credential request** for managed Windows devices.
An authorized staff member who is blocked from a specific device (and knows its
PIN length — 4, 6, or 8 digits, because they have been blocked by it before)
selects **Request unlock** in the Tools menu, picks the digit length, and the
Windows agent shows a neutral, non-deceptive

- **Windows Security**
- **Device locked**
- **Enter your password to unlock this device.**
- **Password:** `••••`  … **[Unlock]**

window. The person physically present at the device types the numeric PIN. It is
submitted over HTTPS to the backend, **encrypted at rest** against **that specific
device** (`DeviceCredential`), and can later be retrieved by an authorized staff
member for servicing the device. Nobody has to keep device passwords in chat /
spreadsheets / tickets / notes / personal managers.

The prompt carries **no technician / organization / customer / product / support
wording** — it reads purely as a device security interaction.

## Windows only

Only Windows is implemented (the only working device agent). The data model is
kept *device-scoped* (`agentId` + `platform`), not Windows-only, so another
platform could be added later without a redesign — but no macOS code ships here.

## Design notes

- Reuses the proven `sendRawCmd` / `runAsUser: true` WinForms-launch pattern from
  `lib/maintenance-overlay.ts` (write script to disk, launch detached, return
  immediately). No display-affinity / click-through / cursor code.
- `runAsUser: true` requires an existing interactive session. If the device is at
  a genuine Winlogon secure desktop with nobody logged in, the prompt simply
  doesn't render — graceful degradation, never an attempt to force a prompt onto
  the real secure desktop or defeat any Windows boundary.
- The credential is entered **at runtime** into the GUI and POSTed to
  `/api/device-callback/credential` using a **one-time, short-lived callback
  token** (stored only as a SHA-256 hash). It is never written to disk, never
  placed on a process command line, never logged, and never echoed back.

## Files

- `prisma/schema.prisma` + migration `20260919000000_add_device_credential_requests`
  — `DeviceCredentialRequest` (lifecycle + token hash, no secret),
  `DeviceCredential` (encrypted PIN, one per `agentId`),
  `DeviceCredentialAuditLog` (who/what/when/result, never the credential).
- `lib/credential-crypto.ts` — AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`), token
  hashing, random-token minting. Fail-closed when the key is unset.
- `lib/device-credential-audit.ts` — never-throwing audit helper.
- `lib/request-unlock.ts` — Windows WinForms prompt + detached launcher.
- `app/api/devices/[agentId]/request-unlock/route.ts` — staff+premium+ownership
  gate; creates request + one-time token; launches the prompt; tracks state.
- `app/api/device-callback/credential/route.ts` — token-authenticated callback;
  validates PIN length; encrypts and stores against the request's agentId.
- `app/api/devices/[agentId]/credential/route.ts` — non-sensitive status read.
- `app/api/devices/[agentId]/credential/reveal/route.ts` — the ONLY endpoint that
  returns the plaintext, and only with staff + per-device authorization + audit.
- `components/remote-tools.tsx` — staff-only **Request unlock** Tools action,
  PIN-length chooser (4/6/8), live request state, and a masked-reveal copy panel.
- `lib/env.ts` / `.env.example` — `CREDENTIALS_ENCRYPTION_KEY`.

## Security boundaries

- **UI gating is not the control.** Every route independently enforces
  `authorizePremiumStaffAgentAction` (authenticated + verified + `isStaff` +
  premium + ownership of THIS `agentId`, via `assertAgentBelongsToClient`). A
  non-staff caller gets 404 and never learns the route exists.
- **Device isolation:** the credential is upserted keyed on `agentId` from the
  request row — never caller-supplied — and retrieve/reveal re-checks authorization
  against the same `agentId`. Device A's credential can never become Device B's.
- **At rest:** AES-256-GCM with a random per-value nonce; `CREDENTIALS_ENCRYPTION_KEY`
  is optional at boot but the crypto functions fail closed (throw) while unset.
- **In transit:** HTTPS (the callback URL is `env.appBaseUrl`).
- **Audit:** `DEVICE_CREDENTIAL_REQUESTED` / `DEVICE_CREDENTIAL_STORED` /
  `DEVICE_CREDENTIAL_RETRIEVED`, never containing the credential.
- **Never:** plaintext storage, plaintext files, command-line arguments, URLs,
  localStorage, logs, or normal status API responses.

## Verification

1. `npx tsc --noEmit` + `npm run build` clean.
2. Authorized staff see the **Request unlock** action and the Device credential
   card; non-staff premium customers see neither, and a direct non-staff POST to
   `request-unlock` / `credential` returns 404.
3. Request → prompt on an interactive session → person enters the PIN → prompt
   closes → status advances to stored → staff reveal returns the value (audited).
4. Credential security confirmed by inspection: no plaintext, no command-line, no
   logging, encrypted at rest, correct-device association, unauthorized retrieval
   blocked.