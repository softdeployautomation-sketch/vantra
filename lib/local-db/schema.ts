import "server-only";

// Task 44.4 — local SQLite schema for the Vantra desktop EXE, devices-first
// (a faithful implementation of the §2.2 DDL in TASK_44_DESIGN_LOCAL_DB.md).
//
// The cloud Postgres stays the mirror/coordinator; this file is the LOCAL,
// disposable-by-design replica. Devices are keyed by TRMM `agent_id` everywhere
// (never a local auto-increment id), authority is asymmetric per field (§2.3),
// and deletes are tombstones (§5.5). Internal sync tables (install_meta, outbox,
// sync_cursor, sync_log, tombstone) never sync — they're bookkeeping.

export const LOCAL_DB_SCHEMA_VERSION = 1;

// Devices-first subset of the design's §2.2 DDL. Local-authoritative fields
// (label via desktop_label, desktop_device.notes/.tags) are marked with `dirty`
// so the sync engine knows what to push; server-authoritative cache fields
// (telemetry, provisioning) are written only by a pull and never set dirty.
//
// Applied transactionally when the DB file is first created (see openLocalDb).
const DDL = `
PRAGMA journal_mode = WAL;

-- The one desktop install on this machine. Persists across launches.
CREATE TABLE IF NOT EXISTS install_meta (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  install_id     TEXT NOT NULL,             -- uuid; minted at first activation
  machine_id     TEXT NOT NULL,             -- hardware-derived (same as EXE licensing)
  product        TEXT NOT NULL DEFAULT 'vantra_exe'
);

-- The merged device view: telemetry (server) + the customer's own metadata.
CREATE TABLE IF NOT EXISTS desktop_device (
  agent_id          TEXT PRIMARY KEY,       -- TRMM agent_id = global identity
  organization_id   TEXT NOT NULL DEFAULT '',
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

-- Customer's own nickname, keyed 1:1 by agent_id (local-authoritative).
CREATE TABLE IF NOT EXISTS desktop_label (
  agent_id        TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT '',
  label           TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  dirty           INTEGER NOT NULL DEFAULT 0,
  origin          TEXT NOT NULL DEFAULT 'local'
);

-- Durable sync queue: every local-authoritative change (upsert or delete) is
-- written here atomically with the row change so it survives a crash and can be
-- replayed in order on reconnect (§4.2 in the design).
CREATE TABLE IF NOT EXISTS outbox (
  id         TEXT PRIMARY KEY,              -- uuid
  entity     TEXT NOT NULL,                 -- 'desktop_label' | 'desktop_device'
  action     TEXT NOT NULL,                 -- 'upsert' | 'delete'
  data       TEXT NOT NULL,                 -- JSON payload (the mutated fields)
  updated_at TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'local',
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | pushed | failed
  created_at TEXT NOT NULL
);

-- Per-table logical cursor for delta pulls (§4.2).
CREATE TABLE IF NOT EXISTS sync_cursor (
  table_name TEXT PRIMARY KEY,
  cursor     TEXT NOT NULL
);

-- Local audit of every applied merge + every LWW loser (§5.6). No data ever
-- vanishes silently — this shows what was overwritten and why.
CREATE TABLE IF NOT EXISTS sync_log (
  id         TEXT PRIMARY KEY,              -- uuid
  kind       TEXT NOT NULL,                 -- 'apply' | 'lww_loser' | 'push' | 'pull' | 'error'
  detail     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Drives deletes both ways (§5.5): a tombstone removes the row locally and is
-- synced up; a pulled server tombstone removes the row here.
CREATE TABLE IF NOT EXISTS tombstone (
  kind       TEXT NOT NULL,                 -- 'desktop_device' | 'desktop_label'
  key        TEXT NOT NULL,                 -- agent_id
  deleted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'local',
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_desktop_device_org_live
  ON desktop_device (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status, created_at);
`;

/** Full schema DDL + indexes, applied in a single transaction on first open. */
export function schemaDdl(): string {
  return DDL;
}