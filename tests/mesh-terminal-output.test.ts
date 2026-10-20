// TASK_234 B — terminal-relay output extraction. The fixture is a VERBATIM
// concatenation of the PS-DATA chunks captured live from Device I
// (node//7Qmu$P8ql…) on 2026-10-20 (probe /tmp/wt4.log on the box) — the
// boot banner, the PSReadLine echo re-renders, the output, and the trailing
// prompt, exactly as MeshCentral's p=6 relay delivers them.
// Run: npx tsx --test tests/mesh-terminal-output.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  endsWithPrompt,
  extractTerminalOutput,
  stripAnsi,
} from "@/lib/mesh-terminal-output";

// Real session: command "Get-Date" typed into the hosted PowerShell.
const REAL_SESSION =
  // boot banner + OSC title + clear
  "\u001b[?9001h\u001b[?1004h" +
  "\u001b[?25l\u001b[2J\u001b[m\u001b[HWindows PowerShell\r\nCopyright (C) Microsoft Corporation. All rights reserved.\u001b]0;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\u0007\u001b[?25h" +
  "\u001b]0;Administrator: C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\u0007" +
  "\r\n\r\n" +
  "PS C:\\Users\\thegreenerland\\AppData\\Local\\Temp> " +
  // PSReadLine echo re-renders (cursor jumps strip to concatenation)
  "\u001b[?25l\u001b[93mGe\u001b[?25h" +
  "\u001b[?25l\u001b[m\u001b[93m\u001b[4;48HGet-\u001b[?25h" +
  "\u001b[m\u001b[?25l\u001b[93m\u001b[4;48HGet-Date\u001b[?25h" +
  "\u001b[m\r\n\r\n" +
  // output + cursor-home + trailing prompt
  "\u001b[?25l20 October 2026 13:59:43\u001b[9;1H\u001b[?25h" +
  "PS C:\\Users\\thegreenerland\\AppData\\Local\\Temp> ";

test("stripAnsi: CSI + OSC escapes vanish, text survives", () => {
  assert.equal(stripAnsi("\u001b[?25l\u001b[93mGe\u001b[?25h"), "Ge");
  assert.equal(stripAnsi("\u001b[4;48HGet-Date"), "Get-Date");
  assert.equal(
    stripAnsi("\u001b]0;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\u0007"),
    "",
  );
});

test("endsWithPrompt: real boot prompt and cmd-style prompt match; mid-output does not", () => {
  assert.equal(endsWithPrompt("PS C:\\Users\\thegreenerland\\AppData\\Local\\Temp> "), true);
  assert.equal(endsWithPrompt("C:\\Windows\\System32>"), true);
  assert.equal(endsWithPrompt("20 October 2026 13:59:43"), false);
  assert.equal(endsWithPrompt("PS C:\\x> Get-Date"), false, "prompt + typed text is not idle");
});

test("extract: the REAL captured session yields exactly the command output", () => {
  assert.equal(extractTerminalOutput(REAL_SESSION, "Get-Date"), "20 October 2026 13:59:43");
});

test("extract: banner + prompt-only session yields honest empty string", () => {
  // Production invariant: runMeshTerminal resets its accumulator at send
  // time, so the banner enters the helper only when the command never
  // echoed AND produced nothing — nothing left = honest empty.
  const bootOnly =
    "\u001b[?25l\u001b[2J\u001b[m\u001b[HWindows PowerShell\r\n" +
    "PS C:\\Users\\x> ";
  assert.equal(extractTerminalOutput(bootOnly, "Windows PowerShell"), "");
});

test("extract: output WITHOUT an echo is preserved in full", () => {
  const raw = "ServiceName    Status\r\nWinRM         Running\r\nPS C:\\Users\\x> ";
  assert.equal(extractTerminalOutput(raw, "Get-Service"), "ServiceName    Status\r\nWinRM         Running");
});

test("extract: multi-line output keeps every line, cuts echo head once", () => {
  const raw =
    "PS C:\\> Get-ChildItem\r\n" +
    "\r\n" +
    "    Directory: C:\\\r\n" +
    "\r\n" +
    "Mode                 LastWriteTime         Length Name\r\n" +
    "----                 -------------         ------ ----\r\n" +
    "d-----        10/20/2026   9:14 AM                Windows\r\n" +
    "PS C:\\> ";
  assert.equal(
    extractTerminalOutput(raw, "Get-ChildItem"),
    "    Directory: C:\\\r\n\r\nMode                 LastWriteTime         Length Name\r\n----                 -------------         ------ ----\r\nd-----        10/20/2026   9:14 AM                Windows",
  );
});

test("extract: command text appearing INSIDE output is not double-cut", () => {
  // echo "Get-Date" prints the literal — lastIndexOf keeps the printed copy.
  const raw = "PS C:\\> Write-Output Get-Date\r\nGet-Date\r\nPS C:\\> ";
  assert.equal(extractTerminalOutput(raw, "Write-Output Get-Date"), "Get-Date");
});

test("pin 18: the wire traps stay documented in the shipped source", () => {
  const api = extractSource("lib/meshcentral-api.ts");
  // TEXT handshake byte, BINARY input frames, prompt-gated send:
  assert.ok(api.includes('relay!.send(String(protocol))'));
  assert.ok(api.includes("relay!.send(Buffer.from(`${opts.command}\\r`))"));
  assert.ok(api.includes('state === "wait-prompt" && endsWithPrompt'));
});

// Local source reader (server-only modules can't be imported into tests).
import { readFileSync } from "node:fs";
import { join } from "node:path";
function extractSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}
