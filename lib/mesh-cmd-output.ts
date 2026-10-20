// TASK_234 — command-output capture for mesh-only (`node//`) devices.
//
// MeshCentral's `runcommands` wire NEVER returns command output (live-proven
// on the box 2026-10-20: the synchronous ack is only "OK"/"Agent not
// connected") — so the only way a mesh agent can show output in the console
// is to POST it back itself. The command is wrapped so the agent runs it,
// captures all streams, and delivers the text to the one-shot ingest route
// below; `runmesh` (captureOutput:true) waits on the sink and returns it.
//
// Security posture of the capability token (the ingest route is PUBLIC — the
// customer's device must reach it over the internet):
//   - 24 random bytes (48 hex chars, 192 bits) — guessing is infeasible within
//     the TTL even at massive rate;
//   - ONE-SHOT (consumed on first delivery) + TTL-bounded (command timeout +
//     15s), swept by timer, so a leaked URL dies fast and cannot be replayed;
//   - worst case of a token compromise is text appearing in the output pane
//     of the very command the token was minted for — no state change, no read.
import { randomBytes } from "crypto";

export interface CmdOutputSink {
  token: string;
  promise: Promise<string | null>;
}

interface PendingSink {
  resolve: (output: string | null) => void;
  timer: NodeJS.Timeout;
}

// In-memory on purpose: single vantra Next process on the box; a cross-request
// registry needs no DB row for data whose lifetime is < 2 minutes.
const pending = new Map<string, PendingSink>();

/** Hard cap on delivered output — the ingest body never grows unbounded. */
export const MAX_CAPTURED_OUTPUT_CHARS = 256 * 1024;

export function createCmdOutputSink(ttlMs: number): CmdOutputSink {
  const token = randomBytes(24).toString("hex");
  const ttl = Math.min(Math.max(ttlMs, 5_000), 120_000);
  const promise = new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(token);
      resolve(null); // timeout is NOT an error — caller reports honest null
    }, ttl);
    // Node exit / test teardown must not hold the process for a dead device.
    timer.unref?.();
    pending.set(token, { resolve, timer });
  });
  return { token, promise };
}

/** One-shot delivery. False = unknown/expired/already-consumed token. */
export function resolveCmdOutputSink(token: string, output: string): boolean {
  const sink = pending.get(token);
  if (!sink) return false;
  pending.delete(token);
  clearTimeout(sink.timer);
  const clipped =
    output.length > MAX_CAPTURED_OUTPUT_CHARS
      ? `${output.slice(0, MAX_CAPTURED_OUTPUT_CHARS)}\n…[output clipped at ${MAX_CAPTURED_OUTPUT_CHARS} chars]`
      : output;
  sink.resolve(clipped);
  return true;
}

/**
 * Dispatch failed → nobody will ever post: drop the sink NOW (resolves null)
 * so no timer lingers for the full TTL. Idempotent; false = already gone.
 */
export function cancelCmdOutputSink(token: string): boolean {
  const sink = pending.get(token);
  if (!sink) return false;
  pending.delete(token);
  clearTimeout(sink.timer);
  sink.resolve(null);
  return true;
}

/** Test-only: drop every pending sink (suite teardown, no live timers). */
export function resetCmdOutputSinksForTests(): void {
  for (const [token, sink] of pending) {
    clearTimeout(sink.timer);
    sink.resolve(null);
    pending.delete(token);
  }
}

/** Ingest base the DEVICE posts to (public internet), not the internal one. */
export function meshIngestBaseUrl(): string {
  return (
    process.env.VANTRA_INGEST_BASE_URL?.trim() || "https://vantra.spaceworker.top"
  );
}

export function cmdOutputIngestUrl(token: string): string {
  return `${meshIngestBaseUrl()}/api/internal/mesh-cmd-output/${token}`;
}

/**
 * PURE — wraps a user command so the mesh agent captures its combined
 * stdout/stderr and POSTs it to the one-shot ingest URL, then still prints it
 * locally (agent log). The token is hex and the URL is a fixed base + hex, so
 * neither can break out of the quoting. The user command sits inside a
 * `& { … }` scriptblock — arbitrary PowerShell, braces-balanced by definition
 * of working PowerShell.
 */
export function wrapCmdForOutputCapture(opts: {
  command: string;
  shell: "powershell" | "cmd";
  token: string;
}): string {
  const url = cmdOutputIngestUrl(opts.token);
  const header = `x-sw-cmd-token: ${opts.token}`;
  if (opts.shell === "cmd") {
    // cmd path: redirect to a temp file, curl it (Win10+ ships curl.exe),
    // echo locally, clean up. Powershell is the default shell; this variant
    // favours plainness over handling unbalanced-paren commands.
    return [
      `( ${opts.command} ) > "%TEMP%\\swcmdout.txt" 2>&1`,
      `curl -s -m 20 -X POST -H "${header}" --data-binary "@%TEMP%\\swcmdout.txt" "${url}" >nul`,
      `type "%TEMP%\\swcmdout.txt"`,
      `del "%TEMP%\\swcmdout.txt"`,
    ].join(" & ");
  }
  return [
    "$ErrorActionPreference='Continue'",
    `$__sw = & {`,
    opts.command,
    `} 2>&1 | Out-String`,
    `try { Invoke-RestMethod -Uri '${url}' -Method Post -Headers @{ 'x-sw-cmd-token' = '${opts.token}' } -Body $__sw -ContentType 'text/plain' -TimeoutSec 20 | Out-Null } catch {}`,
    `Write-Output $__sw`,
  ].join("\n");
}
