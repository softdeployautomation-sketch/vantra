# Task 44.1 — Vantra Desktop EXE: Local-Database Design (schema + sync + conflict handling)

**Status: DESIGN — no implementation code yet.** This is the written-down design pass
required *before* Task 44 build-step 5 ("Local DB implementation"). It covers the local
schema (devices first), the sync-to-cloud strategy, and conflict handling, plus what stays
backend-only. Read this before writing any local-DB code.

Companions: `TASK_44_VANTRA_DESKTOP_EXE.md` (parent ask), `prisma/schema.prisma` (cloud
schema), `EXE_BUILD_LESSONS_LEARNED.md` in the spaceworker repo (Tauri-EXE build gotchas).

---

## 0. Scope and design posture

The confirmed requirement (owner, 2026-09-18): the desktop app owns **a real local
database** on the machine. Devices added through the EXE are stored locally and the app
manages/views them **independently of the backend**. The **cloud Postgres DB becomes a
backup / mirror** for desktop users — data still reaches Vantra's servers, but no longer
as the primary read/write path.

This design pass deliberately covers **devices only** (the concretely-named use case), as
instructed, but the sync/conflict machinery is built so other surfaces (tickets, settings,
scripts) can be added later without redesigning it.

Four load-bearing posture decisions, stated up front:

1. **SQLite is the local engine.** Single-file, embedded, zero admin, WAL-mode concurrency,
   ships inside the EXE. Schema defined as DDL below; accessed via a native Node binding.
   Primary recommendation: `better-sqlite3` — small native module, synchronous, transactional,
   no separate engine binary to bundle (a real concern given the Windows `node.exe` / native
   binary bundling lessons). A Prisma-sqlite mirror was considered and rejected: it drags a
   second Prisma query-engine binary into the standalone runtime.
2. **The device is keyed by TRMM `agent_id` everywhere** (opaque string, no local FK to
   TRMM) — the exact posture the cloud schema already uses for `DeviceLabel`,
   `DeviceGroupMember`, `DeviceStatusSnapshot`, `QueuedAgentCommand`. The local DB does
   **not** invent a new device primary key; `agent_id` stays the global identity.
3. **One account can run many EXEs.** The cloud is the single coordination point; local DBs
   are interchangeable replicas that converge through the cloud mirror. Hardware-unique
   `agent_id`s are the merge key, not local auto-increment ids.
4. **Field authority is asymmetric and is the primary conflict-handling tool.** Every field
   is classified *local-authoritative* (customer edits it here, then pushes up) or
   *server-authoritative* (the web/backend owns it; the local DB only caches it). Most device
   "management" fields are local-authoritative; most telemetry and everything about
   provisioning/licensing is server-authoritative or backend-only. Designing authority *by
   field* up-front prevents almost all real conflicts before they occur.

---

## 1. Grounded context (what already exists in the cloud schema)

Verified in `prisma/schema.prisma` and running routes — not assumed:

- **Devices are not first-class cloud rows.** Inventory lives in TRMM (Django); Vantra's API
  reads it live via `listAgents(trmmClientId)` and merges local metadata. The device-list
  response shape (`app/api/devices/route.ts`) is
  `{ agent_id, hostname, status, last_seen, operating_system, siteName, label, checks }`.
- Cloud rows already **scoped by `agent_id`**: `DeviceLabel` (`org+agentId → label`),
  `DeviceGroup` / `DeviceGroupMember` (`org` membership, agent ids), `DeviceStatusSnapshot`
  (`user+agent → last_status`), `QueuedAgentCommand` (`agentId, shell, cmd, timeoutSeconds,
  runAsUser, status`), `DeviceCredential` (encrypted at-rest), `TechnicianSessionLog`.
- **Provisioning is backend-owned**: `Deployment` (`installMethod, msiReady, vbsUrl, exeUrl,
  zipUrl, monType, goarch, expiresAt`), created/served by the MSI/ZIP generator
  (`lib/msi-generator.ts`, `lib/zip-generator.ts`, `lib/provision.ts`). This is the one thing
  that "always calls home."
- **Multi-org is real**: `Organization` (`ownerId, trmmClientId, trmmSiteId, plan,
  premiumExpiresAt`) with `User.activeOrgId`. The device list is org-scoped (`trmmClientId`).
- **Admin bulk remote exec** (req #11): admin-only, scoped to one customer's own device set,
  single or bulk. Mechanism exists per-device already (`/api/devices/[agentId]/cmd`, queue,
  scripts); "bulk" and "admin-cross-customer access" are the new parts.
---

## 2. Local schema — devices first

### 2.1 Entity list

| Local table | Key | Authority | Sync direction |
|---|---|---|---|
| `install_meta` | singleton | **local-only** (this EXE's identity/keys) | never syncs |
| `profile` | email (licensee) | **server-authoritative** (which User/org a license maps to) | pull-only cache |
| `organization` | org id | server-auth fields; *name* local-editable | two-way (authority by field) |
| `desktop_device` | TRMM `agent_id` | mixed — see §2.3 | two-way |
| `desktop_label` | `agent_id` (1:1) | **local-authoritative** (customer's own nickname) | push-up, merged by agent_id |
| `desktop_group` / `desktop_group_member` | org-scoped | **local-authoritative** (customer organizes own devices) | push-up, keyed by org |
| `queued_command` | uuid | **local-authoritative** (authored offline/in EXE) then handed to server | push-up → server executes |
| `status_snapshot` | `agent_id` | **server-authoritative** (online/offline lives with heartbeat) | pull-only cache |
| `outbox` | uuid | local sync-engine queue | internal (never syncs) |
| `sync_cursor` | per-table | local bookkeeping | internal |
| `tombstone` | kind + key | local bookkeeping | drives deletes both ways |
| `sync_log` | uuid | local audit | internal |

Explicitly **NOT** in the devices-first schema (deferred, §10): tickets, scripts content,
device credentials, technician-session events, notification preferences, billing. These stay
server-owned; the local cache only mirrors them in later scope steps.

### 2.2 DDL (SQLite — design reference, created in build step 5)

```sql
PRAGMA journal_mode = WAL;

-- The one desktop install on this machine. Persists across launches.
CREATE TABLE install_meta (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  install_id     TEXT NOT NULL,             -- uuid; minted at first activation
  machine_id     TEXT NOT NULL,             -- hardware-derived (same as EXE licensing)
  product        TEXT NOT NULL DEFAULT 'vantra_exe'
);

-- The signed-in desktop profile = the licensee email resolved to a Vantra User.
-- A cache of server truth; never authored locally.
CREATE TABLE profile (
  email             TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,          -- the matching Vantra User.id
  active_org_id     TEXT,                   -- org switcher default
  desktop_mode      INTEGER NOT NULL DEFAULT 1,
  license_plan      TEXT,
  license_expires_at TEXT,
  updated_at        TEXT NOT NULL           -- server clock
);

-- Mirror of a cloud Organization, plus a local-editable display name.
CREATE TABLE organization (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,           -- local-authoritative (customer display name)
  trmm_client_id   INTEGER,                 -- server-authoritative, read-only cache
  trmm_site_id     INTEGER,                 -- server-authoritative
  plan             TEXT NOT NULL DEFAULT 'free',
  premium_expires_at TEXT,
  updated_at       TEXT NOT NULL,           -- server logical clock where server-set
  dirty            INTEGER NOT NULL DEFAULT 0 -- 1 when name changed locally, unsynced
);

-- The merged device view: telemetry (server) + the customer's own metadata.
CREATE TABLE desktop_device (
  agent_id          TEXT PRIMARY KEY,       -- TRMM agent_id = global identity
  organization_id   TEXT NOT NULL,          -- which org the device belongs to
  hostname          TEXT,                   -- server-authoritative (TRMM)
  status            TEXT,                   -- server-authoritative (online/offline/overdue)
  last_seen         TEXT,                   -- server-authoritative
  operating_system  TEXT,                   -- server-authoritative
  site_name         TEXT,                   -- server-authoritative (sanitized)
  label             TEXT,                   -- local-authoritative (echo of desktop_label)
  notes             TEXT,                   -- local-authoritative, customer free-text
  tags              TEXT,                   -- local-authoritative, JSON array of strings
  mon_type          TEXT,                   -- server-authoritative (from Deployment)
  goarch            TEXT,                   -- server-authoritative
  install_method    TEXT,                   -- server-authoritative
  msi_ready         INTEGER,                -- server-authoritative
  provision_url     TEXT,                   -- server-authoritative (vbs/exe/zip URL)
  expires_at        TEXT,                   -- server-authoritative (Deployment expiry)
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,          -- logical clock
  deleted_at        TEXT,                   -- tombstone; NULL = live
  dirty             INTEGER NOT NULL DEFAULT 0, -- local-unsynced local-auth field change
  origin            TEXT NOT NULL DEFAULT 'cloud' -- 'cloud' | 'local'
);

CREATE TABLE desktop_label (
  agent_id        TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  label           TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  dirty           INTEGER NOT NULL DEFAULT 0,
  origin          TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE desktop_group (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  dirty           INTEGER NOT NULL DEFAULT 0,
  deleted_at      TEXT,
  UNIQUE (organization_id, name)
);

CREATE TABLE desktop_group_member (
  group_id   TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dirty      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, agent_id)
);

-- Commands the user queued from the EXE (incl. offline). Server owns execution
-- once pushed; the live/queue/scripts routes + telegram poller remain the executor.
CREATE TABLE queued_command (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  shell          TEXT NOT NULL,             -- 'cmd' | 'powershell'
  cmd            TEXT NOT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  run_as_user    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'queued', -- local: queued | pushed | push_failed
  pushed_at      TEXT,
  created_at     TEXT NOT NULL,
  dirty          INTEGER NOT NULL DEFAULT 1
);

-- Read-only cache of online/offline per agent (drives status tiles).
CREATE TABLE status_snapshot (
  agent_id    TEXT PRIMARY KEY,
  last_status TEXT NOT NULL,                -- online | offline | overdue
  updated_at  TEXT NOT NULL                 -- server clock
);
```

Indexes added at build: `desktop_device(organization_id, deleted_at)`,
`desktop_group_member(agent_id)`, `queued_command(agent_id)`.

### 2.3 Field authority — the merge rule that prevents most conflicts

Classify every field by who may write it; the sync engine enforces this mechanically.

| Local table / field | Authoritative writer | Conflicts possible? |
|---|---|---|
| `desktop_device.notes`, `.tags` | **local** (this EXE) | yes — LWW across EXEs, never vs web (web has no such surface in desktop mode) |
| `desktop_label` | **local** (customer nickname) | yes — LWW across EXEs |
| `desktop_group` / `desktop_group_member` | **local** | yes — LWW across EXEs |
| `queued_command` | **local** (authoring) → server (execution) | row owned by authoring EXE; execution state server-owned and pulled |
| `desktop_device.status/.last_seen/.hostname/.os/.site_name` | **server** (TRMM heartbeat + listAgents) | no — local is a read-only cache; server always wins |
| `desktop_device.mon_type/.goarch/.install_method/.msi_ready/.provision_url/.expires_at` | **server** (Deployment / provisioning) | no — backend-only to author; local fires "generate installer" but never invents the URL |
| `organization.plan/.trmm_*/.premium_expires_at` | **server** | no — cache only |
| `profile.*` | **server** | no — cache only |

This asymmetry is the core of §5. **Every field's authority is defined once here and enforced
by the sync merge in §5.2.**

---

## 3. What stays backend-only (regardless of the local DB)

These never honor local writes; the EXE may only *seed* local rows from their outputs, and it
reaches them by calling home:

1. **Installer / provisioning generation** — MSI/ZIP generator, TRMM client/site creation,
   `msiReady` / VBS/EXE/zip URL minting, `mon_type` / `goarch` / `expires_at` computation
   (`lib/provision.ts`, `lib/msi-generator.ts`, `lib/zip-generator.ts`). The EXE's "Add
   Device" **always** calls the backend for this; nothing about installer bytes is produced
   locally. This is the confirmed single "always calls home" path.
2. **License issuance & admin generator** — Vantra's own generator + `EXE_LICENSE_SECRET`
   (separate from SpaceWorker's; Task 44 "separate generator, separate secret"). The local
   EXE *validates* its key offline against the embedded secret (SpaceWorker pattern) but
   never mints one.
3. **Billing / wallet top-up / payments** — stays on the web (the carved-out web surface).
4. **Admin functions** — full device visibility, ticket triage, and the new **bulk remote
   cmd/PowerShell execution** (admin-only, single-customer-scoped). The bulk runner is a
   server-side fan-out over existing cmd/queue/script mechanisms, not a local feature.
5. **Agent lifecycle / heartbeat aggregation / online-offline transitions** — status truth,
   the poller, transition detection, and their notification triggers.
6. **Cloud-side security** — credential encryption keys, signing, authz. Device credentials
   and any sensitive plane plaintext stay server-side; a local mirror (when added later)
   stores only ciphertext encrypted with a **local** AES key, never the server key.
7. **Auto-update manifest + binary hosting** — update checks and artifact distribution are
   server-managed (req #7); the EXE only checks and applies.

Nuance: a *server-authoritative* field (e.g. installer URL) can still be **displayed** in the
EXE and even *demanded on demand* ("generate installer" returns a URL the EXE caches
locally). That is a remote call + local cache of a result, not local authority.
---

## 4. Sync strategy: what syncs, how, how often

### 4.1 Topology and direction

The cloud Postgres (Vantra's own) is the **single cloud mirror / backup** and coordination
point — the only glue between (a) the desktop EXE and (b) the web / billing / admin export.
The device *management* path is local-first; the device *truth* and all provisioning is
server-first.

- **Push (local → cloud):** local-authoritative rows whose `dirty = 1` — labels, group
  membership, `notes`/`tags`, org display name, queued-command authoring. The sync engine
  writes deltas to `outbox` and uploads them as a batch.
- **Pull (cloud → local):** the current device manifest (agent ids, telemetry, provisioning)
  + per-agent status + profile / org / plan. Because web-side devices are always reconciled
  through TRMM, the EXE pulls a manifest and upserts it into the local cache, preserving
  local-authoritative columns that the pull does **not** overwrite (see §5.2 merge).

### 4.2 Mechanism

Each syncable row carries a **logical clock** — `updated_at` (UTC timestamp, server- or
client-assigned) plus `origin` — and an explicit `dirty` flag. There is no vector clock; this
design intentionally uses **last-writer-wins with a deterministic tie-break** (§5.2), which
is more than sufficient under the field-authority asymmetry above.

- **Delta pull:** the client tracks `sync_cursor` per table (the max `updated_at` seen). A
  pull asks for rows `WHERE updated_at > :cursor` (plus tombstones); the server returns them;
  the client upserts. Pull keeps server-authoritative fields as-is and applies LWW for
  local-authoritative fields when the server side won (§5.2).
- **Batch push:** the client sends `{ entity, action: upsert|delete, data, updated_at, origin }`
  per dirty row, atomically per table. The server applies field-authority rules, and for
  local-authoritative conflicts applies LWW (§5.2), then replies with accepted revs + any
  resolved conflict. The client clears `dirty` and advances its cursor on success.
- **Idempotence:** every operation is keyed by the global id (`agent_id`, org id, group id,
  uuid). Re-pushing the same `updated_at` is a server-side no-op, so retries after a dropped
  response are safe.
- **Outbox as durable heartbeat:** unsynced changes are written to `outbox` and `dirty` in the
  same transaction; the engine flushes `outbox` in order and replays from the first failed
  entry with capped backoff (e.g. 10s → 30s → 60s) on reconnect.

### 4.3 Frequency / triggers

- **Immediate-on-commit (debounced ~ a few seconds):** any local edit to a local-authoritative
  field enqueues a flush.
- **Background poll:** every **60 seconds** while online (from the bundled server; same
  cadence discipline as the telegram-device-check poller): pull server truth + push any
  accumulated dirty rows.
- **App events:** on launch (initial pull + replay outbox), on graceful close / suspend
  (flush pending outbox). Sleep/resume routes through the same reconnect/backoff path.
- **Manual:** an explicit *"Sync now"* in Settings (same place as license + updates),
  satisfying req #3's "Settings is the one place" convention.

### 4.4 Transport & auth

- HTTPS to Vantra's own API (`/api/desktop/sync/*` — new routes, built in step 5).
- Peer auth = **desktop install credential**: on first activation the EXE exchanges
  email + validated license for a short-lived signed session token **bound to `install_id`
  and `machine_id`** (per-install, not the web password session — consistent with req #4's
  "email + license, not password" model). The web session is never used by the EXE.
- Server-scoped to the licensee's `User` and their orgs; every sync request is org-scoped
  (same posture as every org-scoped route today).

### 4.5 What does *not* sync

- `install_meta`, `outbox`, `sync_cursor`, `sync_log` are local-only internals.
- Local UI state / layout / preferences are local-only unless a later settings-sync step
  explicitly promotes them.

---

## 5. Conflict handling

Conflict handling is built on the field-authority asymmetry of §2.3: the only real conflicts
are *local-authoritative fields edited on two different EXEs*. Everything else is either
server-authoritative (server wins, pulled) or single-writer by construction. This keeps the
merge algorithm simple and safe.

### 5.1 The primary defense is authority, not resolution

- **Server-authoritative fields (status, telemetry, provisioning, plan, profile):** no merge
  needed — the server is the only writer; the local side only caches, and a pull overwrites
  its cache. Web edits (e.g. provisioning, plan changes) become pushes-down that the EXE
  accepts unconditionally. Zero conflicts possible.
- **Local-authoritative fields (label, notes, tags, group membership, org name):** the only
  realistic multi-writer case is "the same account has the EXE open on two machines." The web
  cannot write these in desktop mode (by design), so an EXE-vs-web write of the same field is
  structurally impossible under the confirmed narrowing.
- **Single-writer structures (queued_command, install rows):** one EXE authors a command; the
  server owns execution and reflects status back. No shared write.

### 5.2 Merge rule: last-writer-wins with a deterministic tie-break

For local-authoritative fields when two writers touch the same row:

1. Compare the row's `updated_at` (UTC). Higher wins.
2. On a **tie** (same `updated_at`), break deterministically by `origin` id: compare
   `install_id` (for EXE-vs-EXE) lexicographically; the server's own id sorts last so the
   server wins ties on server-authored rows. The result is a total order — always the same
   merge outcome on both machines regardless of pull order.
3. The loser is recorded in `sync_log` (see §5.6) and dropped; no data is silently mangled —
   the audit shows what was discarded.

The merge is **per-field within a row** where fields are independent. When a pull delivers a
server row, only the server-authoritative columns overwrite; local-authoritative columns
(`notes`, `tags`, `label` echo) are only touched by a push that carries a newer `updated_at`.
This prevents a routine status pull from clobbering a note the user just typed.

### 5.3 Two EXEs, same account (the main case)

Scenario: label set to "Mum's Laptop" on machine A and "Family PC" on machine B.

- A pushes its label (`updated_at = t1`), server stores it, B's next pull sees `t1` and
  accepts it. B's own later edit upserts with `t2 > t1`.
- Both machines pull the same mirror, so after each sync they converge on the winner. Because
  `agent_id` is the key and the merge is deterministic, there is no divergence that could
  cause a device to appear "in two places."
- Devices **added** on A push up and appear on B's pull as new rows (server-authoritative
  `organization_id` + telemetry, plus that row's local-authoritative fields). No device is
  ever duplicated because the key is `agent_id`, not local row id.
- Deletes are tombstones (see §5.5): A marking a device removed tombstoned on the server;
  B's pull deletes it locally. If B re-adds/edits a tombstoned agent, the newer `updated_at`
  wins and revives it.

### 5.4 EXE + the (limited) web session

Because the web is narrowed in desktop mode to billing/licensing only (req #9), the web and
the EXE never both write the same device-management field. Where the surfaces do overlap
(plan, provisioning, license):

- Those are all **server-authoritative** fields. The web writes them; a pull pushes them down
  to the EXE; the EXE never writes them back. No conflict, by authority.
- Org **name** is marked local-authoritative in §2.3 because the customer edits it from the
  EXE; the one theoretical overlap (if an existing web session still lets a desktop-mode user
  rename their org before a future narrowing lands) is covered by the same LWW rule with the
  server id as a deterministic tie-break.

### 5.5 Deletes / tombstones

- A delete is a soft delete: `deleted_at` is set (locally on a local-authoritative row, or via
  pull on a server-authoritative row). Tombstones are synced both directions so a delete made
  on A removes the device on B and in the mirror, and a server-side/ admin delete removes it
  everywhere.
- Local vs. global device "remove": in this design, a customer "remove" of a device is a
  **server-authoritative** delete (it decommissions the TRMM site / revokes provisioning), so
  it originates server-side and is pulled down. The tombstone machinery still drives B's local
  removal. Deletion without installer generation is never a local-only action.

### 5.6 Conflict visibility & recovery

- The `sync_log` table records every applied merge and every LWW loser ("label overwritten:
  `old` → `new` by install B at t"). No data vanishes silently.
- The Dashboard (or device detail) can surface a subtle "recently changed on another device"
  affordance when a pull updates a local-authoritative row, so a user isn't surprised their
  label changed. Reverting is just a new edit (LWW again) — no undo system needed in v1.

### 5.7 What deliberately does NOT happen

- No manual merge dialogs / three-way UI in v1 — overkill for low-stakes fields (labels,
  notes, tags, group names). LWW + audit + a "changed elsewhere" hint covers every realistic
  desktop-mode conflict.
- No CRDT / vector clocks — the authority asymmetry makes LWW-with-tie-break sufficient, and
  a heavier scheme would add real implementation risk for no user-visible gain at this scope.
---

## 6. Local-DB security & integrity

- **At-rest encryption:** the SQLite file is created under the user's app-data dir (per-user
  ACLs, matching Tauri conventions) in WAL mode. `better-sqlite3` has no built-in encryption;
  for devices-first the DB holds no secrets (only cached telemetry + customer metadata). The
  sensitive values that might later land locally — device credentials, any cached plane
  material — are encrypted at the application layer with a **local** AES-256-GCM key derived
  from `machine_id` and stored via the OS credential vault (Windows DPAPI / Keychain), so the
  DB file itself never contains plaintext secrets and a file copy is not enough to decrypt.
- **No server secrets in local DB:** the embedded `EXE_LICENSE_SECRET` (used for offline
  license validation) is compiled into the binary as today; it is not written to the DB.
- **Per-install identity:** `install_id` + `machine_id` bind sync tokens. A stolen DB file
  without the install secret cannot push/pull as the victim's EXE.
- **Integrity:** schema migrations are applied transactionally (`schema_version`); WAL ensures
  crash safety. Corrupt-file recovery falls back to a fresh DB re-seeded from the mirror on
  next sync (the local DB is disposable by design — a real advantage of "cloud as backup").

---

## 7. Cloud-side changes required to act as the mirror

The cloud Postgres is the coordination hub; several small, additive changes are needed so the
mirror works without disturbing the existing web surface:

- **New tables:** `DesktopInstall` (`install_id`, `userId`, `licenseeEmail`, `machine_id`,
  `product`, `first_seen_at`, `last_seen_at`, `is_active`, `revoked_at`) and `SyncCursor`
  (per install, per table). Optionally a lightweight `SyncAuditLog` (mirror of local
  `sync_log`) populated on push resolutions, so admin can see LWW decisions.
- **Existing tables** already keyed by `agent_id`/`org` serve as the mirror rows for sync:
  `DeviceLabel`, `DeviceGroup`, `DeviceGroupMember`, `Organization`, `Deployment` (read-side),
  `DeviceStatusSnapshot`. Sync reuses them rather than adding parallel device tables — devices
  remain "not first-class," consistent with today.
- **New API routes** (`/api/desktop/sync/*`): pull-manifest (device list + telemetry +
  provisioning, deltas), push (local-authoritative rows, LWW + authority enforcement),
  install registration / token exchange, and the "generate installer" call the EXE always
  makes. Auth is the per-install token, not the web session.
- The web's existing routes are untouched; the narrowing in req #9 is applied separately at
  the web session layer, not in the sync API.

---

## 8. Staged migration / expansion (beyond devices)

The machinery above is surface-agnostic. Later scope steps add mirror tables for each new
surface without redesigning sync:

1. **Devices (this pass).** Tables in §2.2.
2. **Device credentials (only if surfaced in desktop mode).** Mirror `DeviceCredential`
   ciphertext only, keys local (§6). Server remains the reveal authority.
3. **Tickets.** Local `ticket` / `ticket_message` caches; EXE-side submission surface posts
   through the server (which matches the licensee email to the real User per req #4). Sync
   reuses cursor + LWW; ticket fields are mostly server-authoritative (status, assignment),
   with the authored body being local-authoritative at creation.
4. **Settings / scripts.** Script *content* stays server-run (backend-only per §3); only their
   metadata/UI state caches locally.

Each step reuses §4/§5 untouched.

---

## 9. Open questions — resolved (owner, 2026-09-18)

1. **"Add Device" offline: CONFIRMED synchronous backend call only.** No offline queueing for
   device creation, matching Cline's own recommendation — provisioning is backend-only, so
   there's no meaningful offline add.
2. **Multi-EXE: intended to be ONE MACHINE PER LICENSE.** Important correction to this design's
   earlier assumption: **machine-locking does not exist yet anywhere in the codebase.**
   Verified directly — `lib/exe-license-validator.ts` only enforces `machine_id` when the signed
   payload carries one, and `generateLicenseKey()` (both real purchases and the admin generator)
   never sets it at issuance. The only per-machine state today is `lib/license-state.ts`'s local
   file — that's bookkeeping on one machine, not a lock; a second machine's own empty file will
   happily accept and bind the same key string. **This sync design's §5.3 ("two EXEs, same
   account") scenario should NOT be built as the primary supported case** — real machine-locking
   (a first-activation "claim" that re-signs the key with `machine_id` server-side, rejecting a
   second machine's claim attempt) needs to land first. See the real machine-lock task below —
   build it into Vantra's Task 44.2 license work from the start, not as a retrofit. Once locked,
   §5.3's multi-EXE conflict machinery becomes a rare edge case (a legitimate re-claim after
   hardware replacement) rather than the everyday path — keep the LWW design as a safety net, but
   don't assume routine multi-machine use.
3. **Org-name authority: CONFIRMED local-authoritative, no web surface writes it for desktop-mode
   users.** §2.3/§5.4 stand as designed.
4. **Status: CONFIRMED needs to be genuinely live, not a periodic pull-cache.** Since desktop-mode
   users no longer watch the web, the EXE needs to feel as real-time as the web does today —
   upgrade §4.2/§7 from "pull-only cache, low cost to add later" to a real requirement: either a
   push channel (SSE/WebSocket from `/api/desktop/sync/*`) or a materially shorter poll interval
   specifically for `status_snapshot`, decoupled from the general 60s sync cadence. Cline's call
   on the exact mechanism, but "eventually live" is not sufficient — build it as live from the
   start.
5. **Web narrowing: CONFIRMED and more specific than originally assumed.** Desktop-mode web
   access = **Settings, Payments, License, Download EXE** — devices/dashboard management is
   hidden. **Tickets are NOT narrowed out** — the web ticket surface stays active and syncs
   bidirectionally with the desktop app's own ticket view (§8 item 3's local ticket cache/EXE-side
   submission surface, built earlier than "later scope" implied — this should move up in priority
   alongside devices, not strictly after).

---

## 10. Decisions locked in this design

| # | Decision | Why |
|---|---|---|
| D1 | SQLite + `better-sqlite3`, WAL | embedded, tiny bundle, no extra engine binary |
| D2 | Key by TRMM `agent_id` | matches existing cloud posture; no invented PK |
| D3 | Cloud Postgres = mirror/backup + coordinator | confirmed "web DB becomes backup" requirement |
| D4 | Asymmetric field authority defined once (§2.3) | prevents almost all conflicts by construction |
| D5 | Sync = cursor delta + LWW + deterministic tie-break | simple, idempotent, sufficient at this scope |
| D6 | Per-install auth (install_id + machine_id), not web session | req #4 model; safe transport binding |
| D7 | Deletes = tombstones, propagate both ways | converges multi-EXE state cleanly |
| D8 | Installer/license/billing/admin/auto-update stay backend-only | req #6 + "always calls home" constraint |
| D9 | No CRDT / no manual merge UI in v1 | authority asymmetry makes them unnecessary |

This document is the reference for Task 44 build-step 5 (and later steps 6–8). Do not start
local-DB implementation until the §9 questions are answered and this design is signed off.