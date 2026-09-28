// Retired-host drift guard (TASK_84 sweep + the src-tauri miss, 2026-10).
//
// Why this exists: TASK_122 (owner decision 2026-09-26) turned
// `vantra.instaweb.top` into a vhost that serves ONLY `/link/` and answers
// `return 404;` for everything else. Any client still pointed at that host
// therefore fails silently AND noisily: a dashboard loaded from the retired
// origin makes relative `fetch("/api/devices")`,
// `("/api/device-groups")` and `("/api/tickets")` calls that all 404. Observed
// live as exactly those three paths returning 404 together, every 30s, from one
// IP — i.e. `components/dashboard-client.tsx`'s own refresh tick, arriving at a
// host that no longer serves the app.
//
// TASK_84 swept the legacy hosts out of the SHIPPED app code, but that sweep's
// list was built by grepping TS source under `app/`, `components/` and `lib/`,
// so it never looked at the Rust desktop shell. `src-tauri/src/main.rs` kept an
// allowlist comparing the popup's host against `vantra.instaweb.top`, meaning a
// rebuilt EXE would still treat the retired host as "ours".
//
// This guard scans the dirs that actually ship and fails if a retired host
// reappears in any of them. Two tests, deliberately paired: one proves no
// retired host is present, the other proves the canonical host IS present — so
// deleting the check outright cannot pass the pair.
//
// Comment-only lines are exempt: prose can't execute, and comments legitimately
// need to name the old host to explain why it's gone. Execution still lands on
// real lines — run against the unfixed tree this guard reported
// `src-tauri/src/main.rs:189`, the functional allowlist entry, which is exactly
// the class of miss TASK_84 made.
//
// Deliberately ADMITTED (live members of the instaweb.top family, not retired):
//   api.instaweb.top    TRMM agent API base (TRMM_API_BASE_URL)
//   agent.instaweb.top  public agent host (per-org allowlist, Task 82)
//   dl.instaweb.top     installer download host (this EXE family's own host)
//   mesh.instaweb.top   MeshCentral front (MESH_BASE_URL)
// Everything under `*.md` is out of scope too: task/plan docs narrate history
// on purpose, and none of them ship to a client or a binary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Run from the repo root: `npx tsx --test tests/legacy-host-drift.test.ts`. */
const ROOT = process.cwd();

/** Hosts retired by TASK_85 / restricted by TASK_122 — must not appear in code. */
const RETIRED_HOSTS = [
  "vantra.instaweb.top",
  "spaceworker.instaweb.top",
  "rmm.instaweb.top",
] as const;

/** The canonical Vantra web-app origin (APP_BASE_URL, HOSTED_APP_URL, EXE_SYNC_HOST). */
const CANONICAL_HOST = "vantra.spaceworker.top";

const SCAN_DIRS = ["app", "components", "lib", "src-tauri/src", "scripts", "exe"] as const;
const SCAN_EXTS = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".rs", ".json", ".ps1"] as const;
const SKIP_DIRS = new Set(["node_modules", ".next", "target", "dist", ".git"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      // `.md` is never shipped to a client; the docs narrate the old hosts by design.
      if (SCAN_EXTS.some((ext) => entry.name.endsWith(ext))) out.push(full);
    }
  }
  return out;
}

/** Comment-only lines are prose — they can't execute, so they're exempt. */
function isComment(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("#") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.startsWith("<!--")
  );
}

function lineHits(file: string, needle: string): string[] {
  const body = readFileSync(file, "utf8");
  if (!body.includes(needle)) return [];
  return body
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes(needle) && !isComment(line))
    .map(({ line, n }) => `${file.replace(ROOT + "/", "")}:${n}: ${line.trim()}`);
}

test("no retired legacy host is hardcoded in any shipping file", () => {
  assert.ok(
    existsSync(join(ROOT, "src-tauri/src/main.rs")),
    `expected to run from the Vantra repo root, but ${ROOT} has no src-tauri/. ` +
      `Run: cd <repo> && npx tsx --test tests/legacy-host-drift.test.ts`,
  );

  const files = SCAN_DIRS.flatMap((d) => {
    const abs = join(ROOT, d);
    return existsSync(abs) ? walk(abs) : [];
  });
  // A vacuous scan would pass silently — fail loudly instead.
  assert.ok(files.length > 50, `scan found only ${files.length} files; the walk is broken`);

  const hits = RETIRED_HOSTS.flatMap((host) => files.flatMap((f) => lineHits(f, host)));

  assert.deepEqual(
    hits,
    [],
    "A retired legacy host is still hardcoded in shipping code.\n" +
      "TASK_122 restricted vantra.instaweb.top to /link/ only; anything pointing " +
      "there now 404s (dashboard refresh: /api/devices + /api/device-groups + /api/tickets).\n" +
      `Repoint to https://${CANONICAL_HOST}:\n` +
      hits.join("\n"),
  );
});

test("the Tauri shell's internal-popup allowlist names the canonical host", () => {
  const shell = readFileSync(join(ROOT, "src-tauri/src/main.rs"), "utf8");

  // Guards against "pass by deletion": the retired-host test above goes green
  // if the allowlist is simply removed, which would push every Vantra
  // window.open() into the system browser (login wall for a desktop session).
  assert.match(
    shell,
    new RegExp(`h == "${CANONICAL_HOST.replace(/\./g, "\\.")}"`),
    `src-tauri/src/main.rs must still treat https://${CANONICAL_HOST} as Vantra's own ` +
      `origin in the on_new_window allowlist`,
  );
});
