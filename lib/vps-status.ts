import "server-only";

import { execFile } from "child_process";
import { readFile } from "fs/promises";
import os from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Real OS-level metrics — unlike lib/system-status.ts (pure HTTP/DB reachability
// pings), this reads local system state directly, which is safe here because
// Vantra's own Node process already runs ON the target VPS (no SSH/remote exec
// involved). Linux-only (/proc, df, ps) — matches the deployment target
// (Ubuntu 22.04) — never invoked with any user-controlled input, so execFile is
// called with fixed argument arrays only (no shell, no injection surface).

export interface VpsProcessInfo {
  command: string;
  memPercent: number;
  cpuPercent: number;
  rssMb: number;
}

export interface VpsMetrics {
  memTotalMb: number;
  memAvailableMb: number;
  memUsedMb: number;
  memUsedPercent: number;
  loadAvg: [number, number, number];
  cpuCount: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskUsedPercent: number;
  uptimeSeconds: number;
  topProcesses: VpsProcessInfo[];
}

async function readMemInfo(): Promise<{ totalKb: number; availableKb: number }> {
  const raw = await readFile("/proc/meminfo", "utf8");
  // MemAvailable (not MemFree) is the real "can I use this" number — it counts
  // reclaimable buffer/cache, matching what `free -h`'s "available" column shows.
  const total = raw.match(/^MemTotal:\s+(\d+)/m);
  const available = raw.match(/^MemAvailable:\s+(\d+)/m);
  return {
    totalKb: total ? Number(total[1]) : 0,
    availableKb: available ? Number(available[1]) : 0,
  };
}

async function readLoadAvg(): Promise<[number, number, number]> {
  const raw = await readFile("/proc/loadavg", "utf8");
  const [one, five, fifteen] = raw.trim().split(" ");
  return [Number(one), Number(five), Number(fifteen)];
}

async function readDisk(): Promise<{ totalKb: number; usedKb: number }> {
  const { stdout } = await execFileAsync("df", ["-k", "/"]);
  const lines = stdout.trim().split("\n");
  const cols = lines[lines.length - 1].split(/\s+/);
  // Filesystem, 1K-blocks, Used, Available, Use%, Mounted-on
  return { totalKb: Number(cols[1]), usedKb: Number(cols[2]) };
}

async function readTopProcesses(limit = 8): Promise<VpsProcessInfo[]> {
  const { stdout } = await execFileAsync("ps", [
    "-eo",
    "comm,%mem,%cpu,rss",
    "--sort=-%mem",
  ]);
  const lines = stdout.trim().split("\n").slice(1, limit + 1); // drop the header row
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const rssKb = Number(parts[parts.length - 1]);
    const cpuPercent = Number(parts[parts.length - 2]);
    const memPercent = Number(parts[parts.length - 3]);
    const command = parts.slice(0, parts.length - 3).join(" ") || "?";
    return { command, memPercent, cpuPercent, rssMb: Math.round(rssKb / 1024) };
  });
}

export async function getVpsMetrics(): Promise<VpsMetrics> {
  const [{ totalKb, availableKb }, loadAvg, disk, topProcesses] = await Promise.all([
    readMemInfo(),
    readLoadAvg(),
    readDisk(),
    readTopProcesses().catch(() => [] as VpsProcessInfo[]),
  ]);

  const memTotalMb = Math.round(totalKb / 1024);
  const memAvailableMb = Math.round(availableKb / 1024);
  const memUsedMb = Math.max(0, memTotalMb - memAvailableMb);

  return {
    memTotalMb,
    memAvailableMb,
    memUsedMb,
    memUsedPercent: memTotalMb ? Math.round((memUsedMb / memTotalMb) * 100) : 0,
    loadAvg,
    cpuCount: os.cpus().length,
    diskTotalGb: Math.round((disk.totalKb / 1024 / 1024) * 10) / 10,
    diskUsedGb: Math.round((disk.usedKb / 1024 / 1024) * 10) / 10,
    diskUsedPercent: disk.totalKb ? Math.round((disk.usedKb / disk.totalKb) * 100) : 0,
    uptimeSeconds: Math.round(os.uptime()),
    topProcesses,
  };
}
