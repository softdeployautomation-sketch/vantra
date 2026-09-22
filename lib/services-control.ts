import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Read/control systemd services for the admin VPS tab. Reading needs NO sudo
// (verified — systemctl show works for an unprivileged user), but start/stop/
// restart goes through passwordless sudo, which is why the controllable set is
// pinned to exactly the units in /etc/sudoers.d/vantra-services and nothing
// else. Mirrors lib/vps-status.ts conventions: fixed argv arrays, no shell, no
// string interpolation, execFile with constants only.

export const SERVICE_ACTIONS = ["start", "stop", "restart"] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

/**
 * Argv tokens. MUST byte-match /etc/sudoers.d/vantra-services exactly — keep the
 * ".service" suffix. This is a SEPARATE list from MANAGED_SERVICES[].controllable
 * (used by the API route's Zod input schema, not derived automatically) — when
 * adding a new controllable unit, both this array AND its MANAGED_SERVICES entry
 * AND the sudoers file all need updating together, or the route will reject the
 * unit as an invalid enum value even though the UI shows it as controllable
 * (confirmed live — this drifted once already when spaceworker-browser.service /
 * extraction-worker.service were added here without updating this list).
 */
export const CONTROLLABLE_UNITS = [
  "meshcentral.service",
  "celery.service",
  "celerybeat.service",
  "daphne.service",
  "spaceworker.service",
  "spaceworker-browser.service",
  "extraction-worker.service",
] as const;
export type ControllableUnit = (typeof CONTROLLABLE_UNITS)[number];

// Which product this service belongs to, for the admin Platform detail pages
// (/admin101/platform/vantra, /admin101/platform/spaceworker) and the Platform
// index's "Shared / Infrastructure" section. "shared" = genuinely used by both
// (the single nginx front door, the single Postgres cluster holding both DBs) —
// not a catch-all for "TRMM-adjacent", which is tagged "vantra" since TRMM is
// Vantra's own backend, not something SpaceWorker touches.
export type ServicePlatform = "vantra" | "spaceworker" | "shared";

export interface ManagedService {
  unit: string; // fully-qualified, also systemd's `Id`
  label: string;
  platform: ServicePlatform;
  controllable: boolean;
  approxMemMb: number; // fallback for "frees ~N MB" copy when stopped
  impact: string; // plain-English consequence, shown in the confirm dialog
}

export interface ServiceState extends Omit<ManagedService, never> {
  activeState: string; // active | inactive | failed | activating | deactivating
  subState: string; // running | dead | exited | failed
  loadState: string; // loaded | not-found | masked
  memMb: number | null; // null when systemd reports none (normal when stopped)
  unknown: boolean; // true when no block came back for this unit
}

/**
 * 7 controllable FIRST (order preserved in the UI), then 7 protected. approxMemMb
 * figures are the verified live cgroup usage from the service inventory. Impacts
 * are shown verbatim in the stop/restart confirm dialog. (spaceworker's
 * approxMemMb is an estimate pending a live reading — it's a small Next.js app.)
 */
export const MANAGED_SERVICES: readonly ManagedService[] = [
  {
    unit: "meshcentral.service",
    label: "MeshCentral",
    platform: "vantra",
    controllable: true,
    approxMemMb: 141,
    impact:
      "Remote control and remote-desktop sessions stop working, and any live session — including your own — disconnects immediately. Agents reconnect on their own once it's started again. TRMM check-ins, alerts and Vantra's device list are unaffected.",
  },
  {
    unit: "celery.service",
    label: "Celery worker (TRMM)",
    platform: "vantra",
    controllable: true,
    approxMemMb: 206,
    impact:
      "TacticalRMM's background worker. Scheduled tasks, automation policies, alert processing and notification emails all stop running. Queued jobs stay in Redis and resume when it starts again, but jobs in flight are killed. Agent check-ins and the device list keep working.",
  },
  {
    unit: "celerybeat.service",
    label: "Celery Beat (TRMM scheduler)",
    platform: "vantra",
    controllable: true,
    approxMemMb: 141,
    impact:
      "TacticalRMM's scheduler. No new scheduled or recurring tasks are queued while it's stopped, and missed windows are skipped rather than caught up on restart.",
  },
  {
    unit: "daphne.service",
    label: "Daphne (TRMM WebSockets)",
    platform: "vantra",
    controllable: true,
    approxMemMb: 101,
    impact:
      "TacticalRMM's WebSocket/ASGI server. The TRMM web UI's live-updating panels stop refreshing. Vantra uses the REST API, not Daphne, so it keeps working.",
  },
  {
    unit: "spaceworker.service",
    label: "SpaceWorker",
    platform: "spaceworker",
    controllable: true,
    approxMemMb: 100,
    impact:
      "SpaceWorker (the lead-extraction/outreach product) becomes unreachable at spaceworker.top for all its users. Vantra and TacticalRMM are unaffected.",
  },
  // Now controllable — /etc/sudoers.d/vantra-services was extended (2026-09-18)
  // with the matching start/stop/restart lines for both units, mirroring the
  // exact format of the 5 pre-existing entries (validated with `visudo -c`
  // before install, current file backed up first). These two run SpaceWorker's
  // browser sessions and extraction jobs — real RAM-relief levers, same as the
  // other SpaceWorker unit above.
  {
    unit: "spaceworker-browser.service",
    label: "SpaceWorker Browser",
    platform: "spaceworker",
    controllable: true,
    approxMemMb: 69,
    impact:
      "Every open interactive browser session (Neko/Chrome) is cut off immediately. It comes back on a VPS reboot but not automatically otherwise — start it again from here when needed.",
  },
  {
    unit: "extraction-worker.service",
    label: "SpaceWorker Extraction Worker",
    platform: "spaceworker",
    controllable: true,
    approxMemMb: 53,
    impact:
      "Any currently-running lead-extraction search is ORPHANED, not paused — it does not resume when this restarts. Its job stays stuck at 'running' with zero progress until someone notices (the dispatcher just silently retries a dead job forever, see app/api/internal/dispatch/route.ts Phase B). Leads already found before the stop are safe (persisted continuously). For a clean pause that actually resumes, use SpaceWorker admin's own Search Queue tab 'Stop worker & pause all runs' instead — this is the raw systemd lever, only for when that's not enough.",
  },
  // --- protected (never controllable) ---
  {
    unit: "rmm.service",
    label: "TacticalRMM API",
    platform: "vantra",
    controllable: false,
    approxMemMb: 1027,
    impact: "Protected — the TRMM API agents and Vantra depend on.",
  },
  {
    unit: "vantra.service",
    label: "Vantra (this app)",
    platform: "vantra",
    controllable: false,
    approxMemMb: 87,
    impact: "Protected — this portal itself.",
  },
  {
    unit: "nginx.service",
    label: "nginx",
    platform: "shared",
    controllable: false,
    approxMemMb: 16,
    impact: "Protected — front-door reverse proxy for Vantra, SpaceWorker, and TRMM.",
  },
  {
    unit: "postgresql@18-main.service",
    label: "PostgreSQL 18",
    platform: "shared",
    controllable: false,
    approxMemMb: 80,
    impact: "Protected — the one Postgres cluster holding both Vantra's and SpaceWorker's databases, plus TRMM's.",
  },
  {
    unit: "nats.service",
    label: "NATS",
    platform: "vantra",
    controllable: false,
    approxMemMb: 9,
    impact: "Protected — TRMM messaging layer.",
  },
  {
    unit: "nats-api.service",
    label: "NATS API",
    platform: "vantra",
    controllable: false,
    approxMemMb: 9,
    impact: "Protected — TRMM messaging layer.",
  },
  {
    unit: "redis-server.service",
    label: "Redis",
    platform: "vantra",
    controllable: false,
    approxMemMb: 7,
    impact: "Protected — TRMM queue store.",
  },
];

const SYSCTL = "/usr/bin/systemctl";
const SHOW_TIMEOUT_MS = 5000;
/**
 * Returns live state for all 14 managed units from ONE systemctl call (no sudo).
 * Parsing notes (all verified live):
 *  - output is blank-line-separated per-unit blocks;
 *  - property order within a block is NOT stable — build a Map<Id, record> and
 *    key off the Id= value;
 *  - each line is split on the FIRST '=' only;
 *  - MemoryCurrent can be "[not set]" or UINT64_MAX — normalise those to null.
 */
export async function listServiceStates(): Promise<ServiceState[]> {
  let stdout: string;
  try {
    const res = await execFileAsync(
      SYSCTL,
      [
        "show",
        ...MANAGED_SERVICES.map((s) => s.unit),
        "--no-pager",
        "-p",
        "Id",
        "-p",
        "LoadState",
        "-p",
        "ActiveState",
        "-p",
        "SubState",
        "-p",
        "MemoryCurrent",
      ],
      { timeout: SHOW_TIMEOUT_MS },
    );
    stdout = res.stdout;
  } catch (err) {
    console.error("listServiceStates: systemctl show failed:", err);
    throw err;
  }

  const byId = new Map<string, Record<string, string>>();
  const blocks = stdout.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const props: Record<string, string> = {};
    for (const line of block.trim().split("\n")) {
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      props[line.slice(0, idx)] = line.slice(idx + 1);
    }
    const id = props["Id"];
    if (id) byId.set(id, props);
  }

  // Emit in MANAGED_SERVICES order (never systemctl's) so the table is stable.
  return MANAGED_SERVICES.map((svc) => {
    const block = byId.get(svc.unit);
    if (!block) {
      return {
        ...svc,
        activeState: "unknown",
        subState: "unknown",
        loadState: "unknown",
        memMb: null,
        unknown: true,
      };
    }
    return {
      ...svc,
      activeState: block["ActiveState"] ?? "unknown",
      subState: block["SubState"] ?? "unknown",
      loadState: block["LoadState"] ?? "unknown",
      memMb: parseMemMb(block["MemoryCurrent"]),
      unknown: false,
    };
  });
}

/** systemd can emit "[not set]"/empty, NaN, or UINT64_MAX — all become null. */
function parseMemMb(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value || value === "[not set]") return null;
  const bytes = Number(value);
  if (Number.isNaN(bytes)) return null;
  if (bytes >= 2 ** 53) return null; // UINT64_MAX sentinel / absurd garbage
  return Math.round(bytes / (1024 * 1024));
}

export class ServiceControlError extends Error {
  constructor(
    readonly code: "not_allowed" | "command_failed" | "timeout",
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ServiceControlError";
  }
}

/**
 * Stops/starts/restarts a controllable unit via passwordless sudo. The unit passed
 * to argv is the MANAGED_SERVICES constant (svc.unit), never the caller's string —
 * equality-match then substitute means no caller-controlled text reaches argv.
 * `-n` makes sudo fail fast instead of hanging on a password prompt.
 */
export async function controlService(
  unit: string,
  action: ServiceAction,
): Promise<void> {
  const svc = MANAGED_SERVICES.find((s) => s.unit === unit && s.controllable);
  if (!svc) {
    throw new ServiceControlError(
      "not_allowed",
      "That service can't be controlled from here.",
    );
  }
  if (!(SERVICE_ACTIONS as readonly string[]).includes(action)) {
    throw new ServiceControlError("not_allowed", `Invalid action: ${action}`);
  }

  try {
    await execFileAsync("/usr/bin/sudo", ["-n", SYSCTL, action, svc.unit], {
      timeout: CONTROL_TIMEOUT_MS,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e && e.code === "ETIMEDOUT") {
      throw new ServiceControlError("timeout", "systemctl timed out.");
    }
    const stderr = (e?.stderr ?? "").slice(0, 200);
    console.error("[services] control failed:", e?.stderr ?? String(e));
    let message = "systemctl command failed.";
    if (/password is required|not allowed to execute/i.test(stderr)) {
      message = "Permission denied — check /etc/sudoers.d/vantra-services.";
    }
    throw new ServiceControlError("command_failed", message, stderr || undefined);
  }

  console.info(`[services] action=${action} unit=${svc.unit} ok`);
}
const CONTROL_TIMEOUT_MS = 30_000;