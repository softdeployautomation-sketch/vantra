// TASK_234 B — PURE helpers for the MeshCentral terminal relay (p=6 PowerShell
// / p=1 cmd). No "server-only": tests import these directly with fixtures cut
// from the LIVE wire (probe on the box, 2026-10-20, Device I node//7Qmu$P8ql…).
//
// Wire truth (byte-verified, meshctrl.js:2809-2815 + live probe):
//   relay open → agent sends 'c' (or 'cr') → client sends
//   {"ctrlChannel":"102938","type":"options",cols,rows} then the TEXT "6"
//   (PowerShell) or "1" (Terminal) → PowerShell boots (~8-21s) → prompt →
//   commands go as BINARY frames Buffer.from(cmd + "\r") — TEXT frames after
//   the handshake are swallowed silently (the 2026-10-20 bug hunt's trap) —
//   output streams back as ANSI-flavoured text until the next prompt.
//   {"ctrlChannel":"102938",…} JSON = ping/pong control — never output.

/** CSI + OSC escapes as emitted by the agent's hosted PowerShell. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "") // OSC … BEL/ST
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "") // CSI (…?25l, [4;48H, [93m…)
    .replace(/\u001b[=>]/g, "");
}

/** Trailing shell prompt: `PS C:\…>` / `C:\…> ` (optional trailing space). */
export const TRAILING_PROMPT_RE = /(?:PS )?[A-Za-z]:[^\r\n]*>[ ]?$/;

/** Does the accumulated (ANSI-stripped) stream END on a fresh prompt? */
export function endsWithPrompt(stripped: string): boolean {
  return TRAILING_PROMPT_RE.test(stripped);
}

/**
 * Cut boot banner + PSReadLine echo + trailing prompt out of the raw stream,
 * leaving the command's own output. PSReadLine re-renders the echoed line per
 * keystroke-paste ("Ge" + "Get-" + "Get-Date"), so the echo head is cut at
 * the LAST full occurrence of the command, then to end of that line.
 */
export function extractTerminalOutput(raw: string, command: string): string {
  let s = stripAnsi(raw);
  const cmd = command.trim();
  const idx = cmd ? s.lastIndexOf(cmd) : -1;
  if (idx >= 0) {
    const nl = s.indexOf("\r\n", idx);
    s = nl >= 0 ? s.slice(nl) : "";
  } else {
    // Echo absent (rare — PSReadLine sometimes doesn't re-render a paste):
    // keep everything as output. The boot banner can never reach here —
    // runMeshTerminal resets its accumulator when the command is sent.
  }
  s = s.replace(TRAILING_PROMPT_RE, "");
  return s.replace(/^(?:\r?\n)+/, "").replace(/\s+$/, "");
}
