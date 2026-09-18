import "server-only";

import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import Database from "better-sqlite3";

import { schemaDdl, LOCAL_DB_SCHEMA_VERSION } from "./schema";
import { getMachineId } from "@/lib/machine-id";
import { isLocalExeRuntime } from "@/lib/exe-runtime";

// Task 44.4 — opens the one local SQLite DB for the desktop EXE and applies the
// devices-first schema on first run. The DB lives in the same per-OS app-data
// location the EXE licensing state already uses (VANTRA_LOCAL_DATA_DIR override
// first, then %APPDATA%|~/Library/Application Support|XDG.../Vantra). It is only
// ever opened by the bundled local runtime (isLocalExeRuntime()); the hosted web
// server never has these tables.
//
// better-sqlite3 is listed in next.config.ts's serverExternalPackages so the
// standalone bundle ships its platform .node binary rather than an inlined stub.

let cached: Database.Database | null = null;

/** Where the local DB file lives, mirroring lib/license-state.ts's location rules. */
export function localDbPath(): string {
  const override = process.env.VANTRA_LOCAL_DATA_DIR;
  const dir = override
    ? path.join(override, "Vantra")
    : (() => {
        const sys = process.platform; // win32 | darwin | linux | ...
        if (sys === "win32") {
          const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
          return path.join(base, "Vantra");
        }
        if (sys === "darwin") {
          return path.join(os.homedir(), "Library", "Application Support", "Vantra");
        }
        const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
        return path.join(dataHome, "vantra");
      })();
  return path.join(dir, "vantra-local.db");
}

/** Row type for the merged device (mirrors desktop_device columns). */
export interface LocalDeviceRow {
  agent_id: string;
  organization_id: string | null;
  hostname: string | null;
  status: string | null;
  last_seen: string | null;
  operating_system: string | null;
  site_name: string | null;
  label: string | null;
  notes: string | null;
  tags: string | null;
  mon_type: string | null;
  goarch: string | null;
  install_method: string | null;
  msi_ready: number | null;
  provision_url: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
  origin: string;
}

export interface LocalLabelRow {
  agent_id: string;
  organization_id: string | null;
  label: string;
  updated_at: string;
  dirty: number;
  origin: string;
}

export interface LocalOutboxRow {
  id: string;
  entity: string;
  action: "upsert" | "delete";
  data: string;
  updated_at: string;
  origin: string;
  status: "pending" | "pushed" | "failed";
  created_at: string;
}

/** Opens (creating + migrating if needed) and caches the local DB connection. */
export async function openLocalDb(): Promise<Database.Database> {
  if (cached) return cached;
  if (!isLocalExeRuntime()) {
    throw new Error("local-db: refusing to open outside the Vantra EXE runtime");
  }
  const file = localDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaDdl());
  await ensureInstallRow(db);
  cached = db;
  return db;
}

async function ensureInstallRow(db: Database.Database): Promise<void> {
  const missing = db
    .prepare("SELECT 1 AS one FROM install_meta WHERE singleton = 1")
    .get() as { one: number } | undefined;
  if (missing) return;
  // machine_id is the hardware-derived EXE id (same as the licensing gate binds a
  // key to). install_id is a fresh uuid minted at first open; both persist in the
  // DB so the same install's origin id is stable across launches (seen §5.2 tie-break).
  const machineId = process.env.VANTRA_MACHINE_ID ?? (await getMachineId());
  const installId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO install_meta (singleton, schema_version, install_id, machine_id, product) VALUES (1, ?, ?, ?, ?)",
  ).run(LOCAL_DB_SCHEMA_VERSION, installId, machineId, "vantra_exe");
}