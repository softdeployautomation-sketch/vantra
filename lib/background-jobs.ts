import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";

import type { ServicePlatform } from "@/lib/services-control";

const execFileAsync = promisify(execFile);

// Read-only visibility into every recurring background job on the box —
// nothing here was previously surfaced anywhere in the admin, including the
// nightly database backup (db-backup.timer), which is exactly what prompted
// this file. Mirrors lib/services-control.ts's conventions: fixed argv, no
// shell, no sudo (systemctl show is readable unprivileged for these units,
// verified live the same way as every other status read in this app).
//
// Deliberately excludes generic OS housekeeping timers (apt-daily, logrotate,
// fstrim, man-db, motd, dpkg-db-backup, etc.) — this page is about OUR jobs,
// not Ubuntu's own maintenance, which nobody needs an admin panel to see.

export interface BackgroundJobDef {
  id: string;
  label: string;
  description: string;
  platform: ServicePlatform;
  timerUnit: string;
  serviceUnit: string;
  /** Hand-authored from the real unit file — see the comment on each entry. */
  schedule: string;
}

export const BACKGROUND_JOBS: readonly BackgroundJobDef[] = [
  {
    id: "db-backup",
    label: "Nightly database backup",
    description:
      "Dumps both the Vantra and SpaceWorker Postgres databases and uploads them to Cloudflare R2 (30-day retention). Sends a Telegram alert to the admin if any part of it fails.",
    platform: "shared",
    timerUnit: "db-backup.timer",
    serviceUnit: "db-backup.service",
    schedule: "Daily at 03:17 UTC", // db-backup.timer: OnCalendar=*-*-* 03:17:00
  },
  {
    id: "spaceworker-dispatcher",
    label: "SpaceWorker job dispatcher",
    description:
      "Picks up queued lead-extraction jobs and advances jobs already in progress.",
    platform: "spaceworker",
    timerUnit: "dispatcher.timer",
    serviceUnit: "dispatcher.service",
    schedule: "Every 10 seconds", // dispatcher.timer: OnUnitActiveSec=10sec
  },
  {
    id: "vantra-telegram-device-check",
    label: "Device online/offline Telegram alerts",
    description:
      "Checks every TacticalRMM agent for an online/offline state change and notifies the linked customer on Telegram.",
    platform: "vantra",
    timerUnit: "vantra-telegram-device-check.timer",
    serviceUnit: "vantra-telegram-device-check.service",
    schedule: "Every 5 minutes", // OnUnitActiveSec=5min
  },
  {
    id: "vantra-telegram-vps-check",
    label: "VPS memory-pressure Telegram alert",
    description: "Notifies the admin on Telegram once VPS memory usage crosses 80%.",
    platform: "vantra",
    timerUnit: "vantra-telegram-vps-check.timer",
    serviceUnit: "vantra-telegram-vps-check.service",
    schedule: "Every 10 minutes", // OnUnitActiveSec=10min
  },
] as const;

export interface BackgroundJobState extends BackgroundJobDef {
  lastRunAt: string | null; // ISO — from the timer's LastTriggerUSec
  lastResult: string | null; // systemd's Result: "success" | "exit-code" | ... | null if never run
  nextRunAt: string | null; // ISO — only populated for calendar-scheduled timers (db-backup)
  timerActive: boolean; // the timer itself is armed and waiting
}

const SYSCTL = "/usr/bin/systemctl";
const SHOW_TIMEOUT_MS = 5000;

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  // systemd emits "n/a" for a property that has never fired, and blank for one
  // that doesn't apply to this unit type.
  if (value === "n/a" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * One systemctl call for every job's timer + service unit. Same parsing rules
 * as listServiceStates(): blank-line-separated blocks, unstable property
 * order within a block, key off Id=. Requesting a timer-only property (e.g.
 * LastTriggerUSec) against a .service unit — or a service-only property (e.g.
 * Result) against a .timer unit — just comes back blank rather than erroring,
 * so it's safe to request the same full property set against a mixed list.
 */
export async function listBackgroundJobs(): Promise<BackgroundJobState[]> {
  const units = BACKGROUND_JOBS.flatMap((j) => [j.timerUnit, j.serviceUnit]);
  let stdout: string;
  try {
    const res = await execFileAsync(
      SYSCTL,
      [
        "show",
        ...units,
        "--no-pager",
        "-p",
        "Id",
        "-p",
        "ActiveState",
        "-p",
        "Result",
        "-p",
        "LastTriggerUSec",
        "-p",
        "NextElapseUSecRealtime",
      ],
      { timeout: SHOW_TIMEOUT_MS },
    );
    stdout = res.stdout;
  } catch (err) {
    console.error("listBackgroundJobs: systemctl show failed:", err);
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

  return BACKGROUND_JOBS.map((job) => {
    const timer = byId.get(job.timerUnit);
    const service = byId.get(job.serviceUnit);
    return {
      ...job,
      lastRunAt: parseDate(timer?.["LastTriggerUSec"]),
      nextRunAt: parseDate(timer?.["NextElapseUSecRealtime"]),
      lastResult: service?.["Result"] || null,
      timerActive: timer?.["ActiveState"] === "active",
    };
  });
}
