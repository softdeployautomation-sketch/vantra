import "server-only";

import { CLONE_EXIT, CLONE_MARKERS } from "./clone-engine";

// TASK_108 (bit B2) — output parsing. sendRawCmd resolves with the command's
// TEXT (TRMM does not surface the process exit code), so every builder in
// lib/clone-engine-cmds.ts appends `SWCLONE_RC <step>=<n>` markers and these
// parsers recover per-step codes from that text.

/** `SWCLONE_RC <step>=<n>` markers → per-step exit codes. */
export function parseRcMarkers(output: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const m = new RegExp(`^${CLONE_MARKERS.rc}\\s+(\\S+)=(\\d+)\\s*$`).exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** `SWCLONE_RELAY <k=v ...>` evidence line → string map. */
export function parseRelayLine(output: string): Record<string, string> {
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(CLONE_MARKERS.relay)) {
      const out: Record<string, string> = {};
      for (const kv of t.slice(CLONE_MARKERS.relay.length).split(/\s+/)) {
        const i = kv.indexOf("=");
        if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return out;
    }
  }
  return {};
}

/** Collect the MT-1 JSON result lines (paths + counts only, never secrets). */
export function collectJsonLines(output: string, max = 40): unknown[] {
  const out: unknown[] = [];
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.endsWith("}")) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      continue;
    }
    if (out.length >= max) break;
  }
  return out;
}

/** F2 rule: partial (1) is partial — never success. */
export function exitSummary(code: number | undefined): "ok" | "partial" | "fail" | "unknown" {
  if (code === CLONE_EXIT.OK) return "ok";
  if (code === CLONE_EXIT.PARTIAL) return "partial";
  if (code === CLONE_EXIT.FAIL) return "fail";
  return "unknown";
}
