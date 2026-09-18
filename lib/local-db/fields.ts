import "server-only";

// Task 44.4 — per-field authority + LWW merge for a pulled cloud device row
// (code §2.3 / §5.2 of TASK_44_DESIGN_LOCAL_DB.md). Server-authoritative fields
// (telemetry, provisioning, inventory derived from TRMM) always take the server's
// value. Local-authoritative fields (the customer's own metadata) defer to the
// LWW clock winner decided by the caller (`serverWins`).
//
// Returns the authoritative winner values for every column (ready for the UPSERT)
// plus the list of local fields that LOST this merge — the sync engine logs those
// to sync_log so nothing is ever overwritten invisibly.

/** Columns the server owns outright — always adopt the server's value. */
const SERVER_AUTHORITATIVE_FIELDS = [
  "hostname",
  "status",
  "last_seen",
  "operating_system",
  "site_name",
  "mon_type",
  "goarch",
  "install_method",
  "msi_ready",
  "provision_url",
  "expires_at",
] as const;

/** Columns the customer owns — LWW between that install and the cloud. */
const LOCAL_AUTHORITATIVE_FIELDS = ["label", "notes", "tags"] as const;

export interface FieldMergeResult {
  /** The authoritative value for each known field (the UPSERT payload). */
  row: Record<string, unknown>;
  /** Local-authoritative fields that lost to the server this merge. */
  losers: string[];
}

export function mergeServerRowIntoDevice(
  existing: Record<string, unknown> | null,
  server: Record<string, unknown>,
  serverWins: boolean,
): FieldMergeResult {
  const row: Record<string, unknown> = {};
  const losers: string[] = [];

  const localExisting = existing ?? {};

  // Server-owned fields: the server value is authoritative, full stop.
  for (const f of SERVER_AUTHORITATIVE_FIELDS) {
    row[f] = server[f] ?? localExisting[f] ?? null;
  }

  // Local-owned fields: adopt the server value only when it won the clock (else
  // keep our existing local value — the server's is a stale competing write).
  for (const f of LOCAL_AUTHORITATIVE_FIELDS) {
    if (serverWins) {
      row[f] = server[f] ?? localExisting[f] ?? null;
      if (server[f] !== undefined && mapUndefined(localExisting[f]) !== mapUndefined(server[f])) {
        losers.push(f);
      }
    } else {
      row[f] = localExisting[f] ?? null;
    }
  }

  // organization_id / created_at / deleted_at handling is done by the caller
  // (they're not device-management fields a pull merges).
  return { row, losers };
}

function mapUndefined(v: unknown): unknown {
  return v === undefined ? null : v;
}