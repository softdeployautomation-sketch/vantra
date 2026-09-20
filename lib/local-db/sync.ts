import "server-only";

import {
  applyServerDevice,
  clearDirtyForPushed,
  getCursor,
  getInstallMeta,
  markOutbox,
  pendingOutbox,
  setCursor,
} from "./repo";
import type { ServerDevice } from "./repo";

// Task 44.4, increment 2: the local<->cloud sync engine for the desktop EXE.
//
// Push flushes the durable outbox to the hosted mirror (/api/desktop/sync/push);
// Pull fetches the cursor delta (/api/desktop/sync/pull) and applies each server
// row via applyServerDevice (LWW + deterministic tie-break + tombstone deletes,
// per design D5 / section 5). Per-install auth (install_id + machine_id) rides
// each request (design D6). Offline (host unreachable) this returns errors while
// the local list keeps working -- that is the local-first claim.

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
  pendingRemaining: number;
}

/** The hosted app the mirror endpoints live on. Overridable for dev/tests. */
export function defaultSyncHost(): string {
  return process.env.EXE_SYNC_HOST ?? "https://vantra.instaweb.top";
}

function authHeaders(
  installId: string,
  machineId: string,
  installSecret: string | null,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-install-id": installId,
    "x-machine-id": machineId,
    // Task 46 — the per-binding install secret is the mirror's actual credential;
    // only sent when the EXE has one (minted at bind time and stored locally).
    ...(installSecret ? { "x-install-secret": installSecret } : {}),
  };
}
async function flushOutbox(
  host: string,
  installId: string,
  machineId: string,
  installSecret: string | null,
): Promise<{ pushed: number; errors: string[] }> {
  const rows = await pendingOutbox();
  const errors: string[] = [];
  if (rows.length === 0) return { pushed: 0, errors };

  const payload = rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    action: r.action,
    data: safeParse(r.data),
  }));

  let res: Response;
  try {
    res = await fetch(`${host}/api/desktop/sync/push`, {
      method: "POST",
      headers: authHeaders(installId, machineId, installSecret),
      body: JSON.stringify({ rows: payload }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { pushed: 0, errors: [`push (offline): ${message(e)}`] };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { pushed: 0, errors: [`push ${res.status}: ${text.slice(0, 240)}`] };
  }

  const body = (await res.json().catch(() => ({}))) as { acked?: string[] };
  const acked = new Set(body.acked ?? []);
  for (const r of rows) {
    await markOutbox(r.id, acked.has(r.id) ? "pushed" : "failed");
  }

  const pushed = acked.size;
  if (pushed > 0) {
    await clearDirtyForPushed(
      rows
        .filter((r) => acked.has(r.id))
        .map((r) => {
          const d = (safeParse(r.data) ?? {}) as { agent_id?: string; updated_at?: string };
          return {
            entity: r.entity,
            agentId: d.agent_id ?? "",
            updatedAt: d.updated_at ?? r.updated_at,
          };
        }),
    );
  }
  return { pushed, errors };
}

async function pullDelta(
  host: string,
  installId: string,
  machineId: string,
  installSecret: string | null,
): Promise<{ pulled: number; nextCursor: string | null; errors: string[] }> {
  const cursor = await getCursor("desktop_device");
  const errors: string[] = [];

  let res: Response;
  try {
    res = await fetch(`${host}/api/desktop/sync/pull`, {
      method: "POST",
      headers: authHeaders(installId, machineId, installSecret),
      body: JSON.stringify({ cursor }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { pulled: 0, nextCursor: null, errors: [`pull (offline): ${message(e)}`] };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { pulled: 0, nextCursor: null, errors: [`pull ${res.status}: ${text.slice(0, 240)}`] };
  }

  const body = (await res.json().catch(() => ({}))) as {
    rows?: ServerDevice[];
    nextCursor?: string | null;
  };
  const rows = body.rows ?? [];
  let pulled = 0;
  for (const row of rows) {
    try {
      await applyServerDevice(row);
      pulled++;
    } catch (e) {
      errors.push(`apply ${row.agent_id}: ${message(e)}`);
    }
  }
  if (body.nextCursor) await setCursor("desktop_device", body.nextCursor);
  return { pulled, nextCursor: body.nextCursor ?? null, errors };
}
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function message(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

/**
 * Run one sync cycle: flush the outbox up, pull the delta down. Errors are
 * collected (not thrown) so the route can report ok plus partial results, and so
 * an offline host degrades to "ok:false, local still fine" instead of 500.
 */
export async function syncLocal(): Promise<SyncResult> {
  const meta = await getInstallMeta();
  const remaining = async () => (await pendingOutbox()).length;

  if (!meta) {
    return { pushed: 0, pulled: 0, errors: ["no install identity"], pendingRemaining: await remaining() };
  }

  const host = defaultSyncHost();
  const initPend = await remaining();

  const push = await flushOutbox(host, meta.install_id, meta.machine_id, meta.install_secret);
  const pull = await pullDelta(host, meta.install_id, meta.machine_id, meta.install_secret);

  return {
    pushed: push.pushed,
    pulled: pull.pulled,
    errors: [...push.errors, ...pull.errors],
    pendingRemaining: initPend - push.pushed,
  };
}