import "server-only";

import { z } from "zod";

// TASK_108 (bit B2) — Browser Clone device-side command layer, part 1:
// constants, markers, zod validators.
export const CLONE_EXIT = { OK: 0, PARTIAL: 1, FAIL: 2 } as const;
export const CLONE_DEFAULTS = {
  engineExe: "C:\\ProgramData\\TacticalRMM\\CloneTool\\hack-browser-clone.exe",
  installDir: "C:\\ProgramData\\TacticalRMM\\CloneTool",
  relayInstallDir: "C:\\ProgramData\\TacticalRMM\\Relay",
  relayExe: "C:\\ProgramData\\TacticalRMM\\Relay\\hack-relay.exe",
  stagingRoot: "C:\\ProgramData\\TacticalRMM\\Clones",
  mt1Script: "C:\\ProgramData\\TacticalRMM\\CloneTool\\Invoke-BrowserClone.ps1",
  relayInstallScript: "C:\\ProgramData\\TacticalRMM\\CloneTool\\install-relay.ps1",
  relayAddr: "127.0.0.1:8118",
  relayPort: 8118,
} as const;
export const CLONE_MARKERS = {
  rc: "SWCLONE_RC",
  relay: "SWCLONE_RELAY ",
  procs: "SWCLONE_PROCS ",
} as const;
export const BROWSERS = ["chrome", "edge", "firefox"] as const;
export type CloneBrowser = (typeof BROWSERS)[number];
export const BROWSER_PROCESS: Record<CloneBrowser, string> = {
  chrome: "chrome",
  edge: "msedge",
  firefox: "firefox",
};
const WINDOWS_PATH_RE = /^[A-Za-z]:\\[^"'`$;&|<>(){}[\]\r\n]{0,220}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{1,96}$/;
const ADDR_RE = /^[A-Za-z0-9.:[\]_-]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*$/;
const JOB_KEY_RE = /^[A-Za-z0-9+/]{40,64}={0,2}$/;
export function cloneIdSchema(label = "cloneId") {
  return z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/, `${label} must be an engine clone id.`);
}
export function windowsPathSchema(label: string) {
  return z.string().min(4).max(240).refine((v) => WINDOWS_PATH_RE.test(v) && !v.includes(".."), {
    message: `${label} must be an absolute local Windows path (no quotes, no traversal).`,
  });
}
export function tokenSchema(label: string, max = 96) {
  return z.string().min(1).max(max).refine((v) => TOKEN_RE.test(v), {
    message: `${label} may only contain letters, digits, dot, dash and underscore.`,
  });
}
export function addrSchema(label = "addr") {
  return z.string().min(3).max(64).refine((v) => ADDR_RE.test(v), { message: `${label} must be host:port.` });
}
export function hostSchema(label = "host") {
  return z.string().min(1).max(64).refine((v) => HOST_RE.test(v) || ADDR_RE.test(v), {
    message: `${label} must be a hostname or IP.`,
  });
}
export function jobKeySchema(label = "jobKey") {
  return z.string().min(40).max(64).refine((v) => JOB_KEY_RE.test(v) && Buffer.from(v, "base64").length === 32, {
    message: `${label} must be base64 encoding exactly 32 bytes.`,
  });
}
/** The child-process env var the MT-1 skin reads the job key from. */
export const MT1_KEY_ENV = "SPACEWORKER_CLONE_KEY";
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
export function tail(text: string, max = 2000): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(trimmed.length - max);
}
