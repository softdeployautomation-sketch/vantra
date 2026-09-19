import "server-only";

// Task 44.2 — the local-EXE-runtime guard. /api/exe-license/status and
// /api/exe-license/activate live in THIS SAME Next.js codebase — the one also
// deployed to the public web server. There is no build-time route-exclusion
// system yet for the Vantra EXE, so without an explicit guard both routes would
// be live, unauthenticated, unlimited-rate endpoints on production: /status runs
// OS commands (machine-id derivation) and writes local trial-state files to the
// SERVER's own filesystem on every call, and /activate would validate real
// license keys against the real EXE_LICENSE_SECRET for anyone who asked.
//
// Fail CLOSED, matching this codebase's established discipline for every other
// capability gate (ADMIN_TOKEN, INTERNAL_CRON_SECRET, EXE_LICENSE_SECRET all
// refuse when unset, never fall open): only the Tauri-bundled local runtime's
// own .env ever sets VANTRA_LOCAL_EXE=true. It must NEVER be set in the
// production VPS's .env — these routes are inert there by default, exactly as
// intended until real build-variant exclusion lands.
export function isLocalExeRuntime(): boolean {
  return process.env.VANTRA_LOCAL_EXE === "true";
}

// Hardcoded rather than read from lib/env.ts — the assembler (scripts/
// runtime-assemble.mjs) writes ONLY VANTRA_LOCAL_EXE/BUILD_TARGET/
// EXE_LICENSE_SECRET into the EXE's .env.local, so anything reading
// APP_BASE_URL-style env here would throw at import time inside the very
// runtime this guards. Used wherever the local runtime needs to reach the
// real hosted app (exe-gate.tsx's handoff, the auto-bind call below).
export const HOSTED_APP_URL = "https://vantra.instaweb.top";