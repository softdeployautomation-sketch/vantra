import "server-only";

import { randomUUID } from "crypto";

import type Database from "better-sqlite3";

import type { DeviceView } from "@/components/device-card";

import { SERVER_ORIGIN } from "./clock";
import { openLocalDb } from "./db";
import type { LocalDeviceRow, LocalOutboxRow } from "./db";
import { mergeServerRowIntoDevice } from "./fields";

// Task 44.4 — the devices-first repository for the desktop EXE: every local read
// and write for the devices surface, plus the durable outbox that queues
// local-authoritative changes for the push side of sync. `agent_id` is the global
// key. Nothing here talks to the network — that's the sync engine (increment 2).

export interface ServerDevice {
  agent_id: string;
  organization_id?: string | null;
  hostname?: string | null;
  status?: string | null;
  last_seen?: string | null;
  operating_system?: string | null;
  site_name?: string | null;
  mon_type?: string | null;
  goarch?: string | null;
  install_method?: string | null;
  msi_ready?: number | null;
  provision_url?: string | null;
  expires_at?: string | null;
  label?: string | null;
  notes?: string | null;
  tags?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
}

export type LocalDb = Database.Database;
/** Shared alias for the SQLite connection passed to module-internal helpers. */
type Db = LocalDb;

export interface InstallMeta {
  install_id: string;
  machine_id: string;
  product: string;
}

/** Local row -> the DeviceView shape the client components already render. */
export function deviceViewFromRow(row: LocalDeviceRow): DeviceView {
  return {
    agent_id: row.agent_id,
    hostname: row.hostname ?? row.agent_id,
    status: (row.status as DeviceView["status"]) ?? "offline",
    last_seen: row.last_seen ?? new Date(0).toISOString(),
    siteName: row.site_name || undefined,
    label: row.label ?? null,
  };
}

export async function getInstallMeta(): Promise<InstallMeta | null> {
  const conn = await openLocalDb();
  const row = conn
    .prepare("SELECT install_id, machine_id, product FROM install_meta WHERE singleton = 1")
    .get() as { install_id: string; machine_id: string; product: string } | undefined;
  if (!row) return null;
  return { install_id: row.install_id, machine_id: row.machine_id, product: row.product };
}

export async function listLiveDevices(opts: { organizationId?: string } = {}): Promise<DeviceView[]> {
  const conn = await openLocalDb();
  const rows = conn
    .prepare(
      "SELECT * FROM desktop_device WHERE deleted_at IS NULL AND (? = '' OR organization_id = ?) ORDER BY updated_at DESC",
    )
    .all(opts.organizationId ?? "", opts.organizationId ?? "") as LocalDeviceRow[];
  return rows.map(deviceViewFromRow);
}

export async function getDeviceView(agentId: string): Promise<DeviceView | null> {
  const conn = await openLocalDb();
  const row = conn
    .prepare("SELECT * FROM desktop_device WHERE agent_id = ? AND deleted_at IS NULL")
    .get(agentId) as LocalDeviceRow | undefined;
  return row ? deviceViewFromRow(row) : null;
}

export async function getDeviceRow(agentId: string): Promise<LocalDeviceRow | null> {
  const conn = await openLocalDb();
  return (
    (conn.prepare("SELECT * FROM desktop_device WHERE agent_id = ?").get(agentId) as
      | LocalDeviceRow
      | undefined) ?? null
  );
}
/** Apply a pulled cloud-mirror row (code §5.2 per-field merge). Returns losers for
 * sync_log audit. Server-authoritative columns always overwrite; local-authoritative
 * columns defer to LWW. A cloud tombstone deletes locally. No outbox writes (pull side).
 */
export async function applyServerDevice(server: ServerDevice): Promise<{
  losers: string[];
  revived: boolean;
  deleted: boolean;
}> {
  const conn = await openLocalDb();
  const agentId = server.agent_id;
  if (!agentId) return { losers: [], revived: false, deleted: false };

  const existing = await getDeviceRow(agentId);
  const now = new Date().toISOString();
  const serverTs = server.updated_at ?? now;

  // Cloud tombstone wins by authority for a delete (code §5.5): remove locally.
  if (server.deleted_at) {
    conn
      .prepare(
        "INSERT INTO tombstone (kind, key, deleted_at, updated_at, origin) " +
          "VALUES ('desktop_device', ?, ?, ?, ?) " +
          "ON CONFLICT(kind, key) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
      )
      .run(agentId, server.deleted_at, serverTs, SERVER_ORIGIN);
    conn
      .prepare("UPDATE desktop_device SET deleted_at = COALESCE(?, deleted_at), updated_at = ?, dirty = 0 WHERE agent_id = ?")
      .run(server.deleted_at, serverTs, agentId);
    conn.prepare("DELETE FROM desktop_label WHERE agent_id = ?").run(agentId);
    logSync(conn, "apply", "pull-delete", { agentId, deletedAt: server.deleted_at });
    return { losers: [], revived: false, deleted: (existing?.deleted_at ?? null) === null };
  }

  // Decide the server-vs-local clock win for local-authoritative columns (code §5.2).
  let serverWins: boolean;
  const localTs: string = existing?.updated_at ?? now;
  if (!existing || existing.deleted_at) {
    serverWins = true; // brand-new / tombstoned row — adopt as-is.
  } else if (serverTs !== localTs) {
    serverWins = serverTs > localTs; // higher clock wins
  } else {
    serverWins = SERVER_ORIGIN > (existing.origin ?? "local"); // tie: server id sorts last
  }

  const merged = mergeServerRowIntoDevice(
    existing ? (existing as unknown as Record<string, unknown>) : null,
    server as unknown as Record<string, unknown>,
    serverWins,
  );
  const localLosers = merged.losers;

  const mergedRow: Partial<LocalDeviceRow> = {
    agent_id: agentId,
    created_at: existing?.created_at ?? server.created_at ?? now,
    updated_at: new Date(
      Math.max(new Date(localTs).getTime(), new Date(serverTs).getTime()),
    ).toISOString(),
    origin: existing?.origin ?? SERVER_ORIGIN,
  };
  for (const [k, v] of Object.entries(merged.row)) {
    (mergedRow as Record<string, unknown>)[k] = v;
  }
  (mergedRow as Record<string, unknown>).dirty = existing?.dirty ?? 0;

  upsertDeviceRow(conn, mergedRow as LocalDeviceRow);

  if (localLosers.length > 0) {
    logSync(conn, "lww_loser", "device-local-field", {
      agentId,
      losers: localLosers,
      detail: "cloud mirror won the local-authoritative fields",
    });
  }
  return { losers: localLosers, revived: existing?.deleted_at ? true : false, deleted: false };
}

/** Bare upsert used internally and by pull; does NOT enqueue to outbox. */
function upsertDeviceRow(conn: LocalDb, row: LocalDeviceRow): void {
  const fields = [
    "agent_id", "organization_id", "hostname", "status", "last_seen", "operating_system",
    "site_name", "label", "notes", "tags", "mon_type", "goarch", "install_method",
    "msi_ready", "provision_url", "expires_at", "created_at", "updated_at", "deleted_at",
    "dirty", "origin",
  ];
  const cols = fields.join(", ");
  const ph = fields.map(() => "?").join(", ");
  const set = fields
    .filter((f) => f !== "agent_id")
    .map((f) => `${f} = excluded.${f}`)
    .join(", ");
  const vals: unknown[] = [
    row.agent_id, row.organization_id ?? "", row.hostname ?? null, row.status ?? null,
    row.last_seen ?? null, row.operating_system ?? null, row.site_name ?? null,
    row.label ?? null, row.notes ?? null, row.tags ?? null, row.mon_type ?? null,
    row.goarch ?? null, row.install_method ?? null, row.msi_ready ?? null,
    row.provision_url ?? null, row.expires_at ?? null, row.created_at ?? new Date().toISOString(),
    row.updated_at ?? new Date().toISOString(), row.deleted_at ?? null, row.dirty ?? 0,
    row.origin ?? SERVER_ORIGIN,
  ];
  conn
    .prepare(
      `INSERT INTO desktop_device (${cols}) VALUES (${ph})
       ON CONFLICT(agent_id) DO UPDATE SET ${set}`,
    )
    .run(...vals);
}

/**
 * Customer edits a device's nickname locally (local-authoritative, code §2.3).
 * Writes the desktop_label row + the desktop_device.label echo + a durable outbox
 * 'upsert' in one transaction so it survives a crash and syncs up on reconnect.
 * Editing a tombstoned device's label revives it (code §5.5: newer updated_at wins).
 */
export async function setLocalLabel(
  agentId: string,
  label: string,
  opts: { organizationId?: string } = {},
): Promise<void> {
  const conn = await openLocalDb();
  const now = new Date().toISOString();
  const tx = conn.transaction(() => {
    const dirty = 1;
    conn
      .prepare(
        `INSERT INTO desktop_label (agent_id, organization_id, label, updated_at, dirty, origin)
         VALUES (?, ?, ?, ?, ${dirty}, 'local')
         ON CONFLICT(agent_id) DO UPDATE SET
           label = excluded.label, updated_at = excluded.updated_at,
           dirty = ${dirty}, origin = 'local'`,
      )
      .run(agentId, opts.organizationId ?? "", label, now);

    conn
      .prepare(
        "UPDATE desktop_device SET label = ?, updated_at = ?, dirty = ?, deleted_at = NULL WHERE agent_id = ?",
      )
      .run(label, now, dirty, agentId);

    // Revive if it was tombstoned and ensure the row exists (upsert).
    conn
      .prepare(
        `INSERT INTO desktop_device (agent_id, organization_id, label, created_at, updated_at, dirty, origin)
         VALUES (?, ?, ?, ?, ?, ?, 'local')
         ON CONFLICT(agent_id) DO UPDATE SET label = excluded.label,
           updated_at = excluded.updated_at, dirty = excluded.dirty,
           deleted_at = NULL, origin = 'local'`,
      )
      .run(agentId, opts.organizationId ?? "", label, now, now, dirty);

    enqueue(conn, "desktop_label", "upsert", { agent_id: agentId, label, updated_at: now });
    enqueue(conn, "desktop_device", "upsert", {
      agent_id: agentId,
      label,
      updated_at: now,
      dirty: dirty,
    });
  });
  tx();
}

/** Local (soft) delete — tombstone + outbox 'delete' so it syncs up (code §5.5). */
export async function deleteDeviceLocal(agentId: string): Promise<void> {
  const conn = await openLocalDb();
  const now = new Date().toISOString();
  const tx = conn.transaction(() => {
    conn
      .prepare(
        "UPDATE desktop_device SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE agent_id = ?",
      )
      .run(now, now, agentId);
    conn.prepare("DELETE FROM desktop_label WHERE agent_id = ?").run(agentId);
    conn
      .prepare(
        `INSERT INTO tombstone (kind, key, deleted_at, updated_at, origin)
         VALUES ('desktop_device', ?, ?, ?, 'local')
         ON CONFLICT(kind, key) DO UPDATE SET deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at`,
      )
      .run(agentId, now, now);
    enqueue(conn, "desktop_device", "delete", { agent_id: agentId, deleted_at: now });
    logSync(conn, "apply", "local-delete", { agentId, deletedAt: now });
  });
  tx();
}

// ---- outbox ---------------------------------------------------------------

function enqueue(conn: Db, entity: string, action: "upsert" | "delete", data: object): void {
  const now = new Date().toISOString();
  conn
    .prepare(
      `INSERT INTO outbox (id, entity, action, data, updated_at, origin, status, created_at)
       VALUES (?,?,?,?,?,'local','pending',?)`,
    )
    .run(randomUUID(), entity, action, JSON.stringify(data), now, now);
}

/** Unsynced outbox rows, oldest first (feed for the push engine). */
export async function pendingOutbox(): Promise<LocalOutboxRow[]> {
  const conn = await openLocalDb();
  return conn
    .prepare("SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC")
    .all() as LocalOutboxRow[];
}

export async function markOutbox(id: string, status: "pushed" | "failed"): Promise<void> {
  const conn = await openLocalDb();
  conn.prepare("UPDATE outbox SET status = ? WHERE id = ?").run(status, id);
}

function logSync(conn: Db, kind: string, action: string, detail: object): void {
  conn
    .prepare("INSERT INTO sync_log (id, kind, detail, created_at) VALUES (?,?,?,?)")
    .run(randomUUID(), kind, JSON.stringify({ action, ...detail }), new Date().toISOString());
}
// ---- sync cursor + dirty clearing (increment 2) --------------------------

/** Read a table's pull cursor (max `updated_at` already merged), or null. */
export async function getCursor(tableName: string): Promise<string | null> {
  const conn = await openLocalDb();
  const row = conn
    .prepare("SELECT cursor FROM sync_cursor WHERE table_name = ?")
    .get(tableName) as { cursor: string } | undefined;
  return row?.cursor ?? null;
}

/** Advance a table's pull cursor (monotonic per §4.2 — higher wins). */
export async function setCursor(tableName: string, cursor: string): Promise<void> {
  const conn = await openLocalDb();
  const existing = await getCursor(tableName);
  if (existing && new Date(existing).getTime() >= new Date(cursor).getTime()) return; // never go backwards
  conn
    .prepare(
      `INSERT INTO sync_cursor (table_name, cursor) VALUES (?, ?)
       ON CONFLICT(table_name) DO UPDATE SET cursor = excluded.cursor`,
    )
    .run(tableName, cursor);
}

/**
 * After a successful outbox flush, clear `dirty` on the local-authoritative rows that
 * were actually pushed. Uses the pushed rows' max `updated_at` per (agent_id, entity) as
 * the watermark so any edit made DURING the flush (which bumps `updated_at` and appends a
 * NEW pending outbox row) keeps its dirty flag and will be re-pushed on the next cycle.
 */
export async function clearDirtyForPushed(
  pushed: Array<{ entity: string; agentId: string; updatedAt: string }>,
): Promise<void> {
  if (pushed.length === 0) return;
  const conn = await openLocalDb();
  // Aggregate the HIGHEST clock per (entity, agent_id) before clearing — outbox rows
  // arrive oldest-first, so using the first seen would clear a mid-flush edit that
  // bumped updated_at (its freshly-appended pending row would be cleared wrongly).
  const stmts = new Map<string, string>([
    ["desktop_device", "UPDATE desktop_device SET dirty = 0 WHERE agent_id = ? AND origin = 'local' AND dirty = 1 AND updated_at <= ?"],
    ["desktop_label", "UPDATE desktop_label SET dirty = 0 WHERE agent_id = ? AND origin = 'local' AND dirty = 1 AND updated_at <= ?"],
  ]);
  const maxByKey = new Map<string, { entity: string; agentId: string; updatedAt: string }>();
  for (const p of pushed) {
    if (!p.updatedAt || !stmts.has(p.entity)) continue;
    const key = p.entity + ":" + p.agentId;
    const cur = maxByKey.get(key);
    if (!cur || p.updatedAt > cur.updatedAt) maxByKey.set(key, p);
  }
  for (const p of maxByKey.values()) {
    const stmt = stmts.get(p.entity)!;
    conn.prepare(stmt).run(p.agentId, p.updatedAt);
  }
}
