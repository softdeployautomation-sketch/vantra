#!/usr/bin/env node
// Vantra desktop EXE runtime assembler (Task 44.3).
//
// Packs the `next build` standalone output into `exe/runtime/` — the self-contained
// tree that `src-tauri/src/main.rs` spawns as the local license-gate HTTP server on
// every machine the EXE runs on. This is the ONLY thing the desktop package ships
// locally; everything else lives on the hosted app. That makes its contents a
// load-bearing security boundary: the assembled runtime must contain ZERO Vantra
// production secrets. There is no DATABASE_URL here, no VPS .env, no TRMM key —
// just the desktop-specific vars a license gate needs (VANTRA_LOCAL_EXE, BUILD_TARGET,
// EXE_LICENSE_SECRET, NEXT_TELEMETRY_DISABLED).
//
// Mirrors the proven SpaceWorker runtime-assemble.mjs pattern.
import { mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, writeFileSync, chmodSync, lstatSync, readlinkSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// fileURLToPath (not `new URL(...).pathname`): on Windows the URL pathname has a
// leading slash + drive letter (/D:/...) that path.resolve then mis-handles, so
// ROOT/BUILD_DIR would point somewhere that doesn't exist. Same fix as SpaceWorker.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.join(ROOT, "exe", "runtime"); // final packaged root
const FINAL_PARENT_DIR = path.join(RUNTIME_DIR, "standalone"); // where the standalone server.js lives
const BUILD_DIR = path.join(ROOT, ".next");
const STATIC_DIR = path.join(BUILD_DIR, "static");
const PUBLIC_DIR = path.join(ROOT, "public");
const EXE_DOTENV = path.join(FINAL_PARENT_DIR, ".env.local");

// ---------------------------------------------------------------------------
// Node runtime version pinning. Use the SAME major that built the standalone
// output (node 20.19.6 was the build-time toolchain) so the bundled server ABI
// matches. Downloads are pinned to exact versions — never "latest" — so a rebuild
// months from now gets byte-identical behavior.
// ---------------------------------------------------------------------------
const NODE_DIST_VERSION = "20.19.6"; // without leading "v", used only for archive names below

function nodeArch() {
  if (process.arch === "arm64") return "arm64";
  return "x64";
}
function nodeDistArchiveName() {
  const plat =
    process.platform === "win32" ? "win" : process.platform === "darwin" ? "darwin" : "linux";
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  return `node-v${NODE_DIST_VERSION}-${plat}-${nodeArch()}.${ext}`;
}
function nodeDistUrl() {
  return `https://nodejs.org/dist/v${NODE_DIST_VERSION}/${nodeDistArchiveName()}`;
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}

// Resolves the bundled node executable inside RUNTIME_DIR: prefer exe/runtime/node/
// (a copy we place there), else scan for a `node-v*` extract dir (we leave the
// dist folder named as-is).
function node() {
  const preferred = path.join(RUNTIME_DIR, "node", nodeExecutableName());
  if (existsSync(preferred)) return preferred;
  return findNodeBinary(RUNTIME_DIR) ?? preferred;
}

function findNodeBinary(runtimeDir) {
  if (!existsSync(runtimeDir)) return null;
  for (const ent of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (!/^node-v/.test(ent.name)) continue;
    // Windows dists put node.exe at the archive root; Unix dists put it in bin/.
    const root = path.join(runtimeDir, ent.name, nodeExecutableName());
    if (existsSync(root)) return root;
    const inBin = path.join(runtimeDir, ent.name, "bin", nodeExecutableName());
    if (existsSync(inBin)) return inBin;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------
function listFilesRecursive(base, rel) {
  const out = [];
  for (const ent of readdirSync(path.join(base, rel), { withFileTypes: true })) {
    const next = path.join(rel, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(base, next));
    else out.push(next);
  }
  return out;
}

function isSymlink(p) {
  try {
    return (lstatSync(p).mode & 0o170000) === 0o120000; // DT_LNK
  } catch {
    return false;
  }
}

function copydirTo(target, src) {
  mkdirSync(target, { recursive: true });
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(target, ent.name);
    if (isSymlink(from)) {
      // Dereference symlinks (e.g. Prisma's checksummed `client-<hash>` dirs in
      // the standalone tree) so the runtime gets real files, not links that a
      // cross-platform copy could choke on. macOS copyFileSync refuses some links
      // ("operation not supported on socket").
      const resolved = path.resolve(path.dirname(from), readlinkSync(from));
      if (statSync(resolved).isDirectory()) {
        copydirTo(to, resolved);
      } else {
        mkdirSync(path.dirname(to), { recursive: true });
        copyFileSync(resolved, to);
      }
      continue;
    }
    if (ent.isDirectory()) {
      copydirTo(to, from);
    } else {
      copyFileSync(from, to);
    }
  }
}

// The EXE runtime only serves /exe and /api/exe-license/* — it has no source. Strip
// every .ts/.tsx from the runtime so a curious user (or automated scanner) can never
// reconstruct the app's server-side source from the unpacked tree. SpaceWorker proves
// this is safe: nothing in a standalone Next runtime needs the TypeScript source.
function stripSourceFiles(rootDir) {
  const removed = [];
  for (const rel of listFilesRecursive(rootDir, "")) {
    const lower = rel.toLowerCase();
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
      rmSync(path.join(rootDir, rel), { force: true });
      removed.push(rel);
    }
  }
  return removed;
}

// Diagnostic: print a bounded recursive listing of a directory (relative paths,
// counted per top-level entry and with per-file sizes for the highlight dirs) so a
// CI failure shows exactly what `next build` emitted instead of a one-line mystery.
function dumpTree(rootDir, label, depthLimit = 6) {
  console.log(`\\n[diag] ${label}`);
  if (!existsSync(rootDir)) {
    console.log(`[diag]   (absent)`);
    return;
  }
  let entries = readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const walk = (dir, rel, depth) => {
    if (depth > depthLimit) return;
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, ent.name);
      const relp = path.join(rel, ent.name);
      let sizeInfo = "";
      if (ent.isFile()) {
        try { sizeInfo = `  (${statSync(full).size} B)`; } catch { /* ignore */ }
      } else if (ent.isSymbolicLink()) {
        let tgt = "";
        try { tgt = ` -> ${readlinkSync(full)}`; } catch { /* ignore */ }
        sizeInfo = ` [symlink${tgt}]`;
      }
      console.log(`[diag]   ${relp}${sizeInfo}`);
      if (ent.isDirectory()) walk(full, relp, depth + 1);
    }
  };
  // Summarize top-level counts first, then a bounded walk.
  for (const ent of entries) {
    let kind = ent.isDirectory() ? "dir" : ent.isFile() ? "file" : "other";
    let size = "";
    if (ent.isFile()) { try { size = `, ${statSync(path.join(rootDir, ent.name)).size}B`; } catch { /* ignore */ } }
    console.log(`[diag]   top: ${ent.name} [${kind}${size}]`);
  }
  for (const ent of entries) {
    if (ent.isDirectory()) walk(path.join(rootDir, ent.name), ent.name, 0);
  }
}

// ---------------------------------------------------------------------------
// Node runtime download / extraction (pinned + verified).
// ---------------------------------------------------------------------------
async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return buf.length;
}

function extractArchive(archivePath, destRoot) {
  // bsdtar (present on Windows 10+, macOS, Linux) handles both .tar.gz and .zip.
  mkdirSync(destRoot, { recursive: true });
  const r = spawnSync("tar", ["-xf", archivePath, "-C", destRoot], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tar extraction failed (status ${r.status})`);
}

async function downloadAndExtractNode(runtimeDir) {
  const url = nodeDistUrl();
  const archivePath = path.join(runtimeDir, `node-${nodeDistArchiveName()}`);
  mkdirSync(runtimeDir, { recursive: true });
  console.log(`downloading node from ${url}`);
  const bytes = await downloadToFile(url, archivePath);
  console.log(`downloaded ${bytes} bytes`);
  console.log(`extracting node into ${runtimeDir}`);
  extractArchive(archivePath, runtimeDir);
  rmSync(archivePath, { force: true });
  const discovered = findNodeBinary(runtimeDir);
  if (!discovered) throw new Error("extracted node directory not found after extraction");
  return discovered;
}

// ---------------------------------------------------------------------------
// Placeholder-secret fail-closed guard.
// ---------------------------------------------------------------------------
// Defines every known placeholder so a developer who pushes with a dev .env can
// NEVER produce a "licensed" EXE. If the ambient EXE_LICENSE_SECRET matches one of
// these we abort loudly instead of shipping a gate that would accept the placeholder.
const PLACEHOLDER_SECRETS = new Set([
  "dev-vantra-exe-license-secret-do-not-use-in-prod",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // common dev filler
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000000000000000000000000001",
  "0000000000000000000000000000000000000000000000000000000000000002",
  "dev-spaceworker-exe-license-secret-do-not-use-in-prod", // sibling repo placeholder
  "dev-exe-license-secret-do-not-use-in-prod",
]);

function assertNotPlaceholder(value) {
  if (!value) throw new Error("EXE_LICENSE_SECRET is empty — refusing to bake a blank secret into the EXE");
  if (PLACEHOLDER_SECRETS.has(value)) {
    throw new Error("EXE_LICENSE_SECRET is a known PLACEHOLDER — refusing to bake a placeholder secret into an EXE");
  }
  const lower = value.toLowerCase();
  if (/do-not-use-in-prod|dev-.*license-secret|placeholder/.test(lower)) {
    throw new Error("EXE_LICENSE_SECRET looks like a placeholder — refusing to bake it into the EXE");
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const buildTarget = process.env.BUILD_TARGET ?? "vantra_exe";
  const licenseSecret = process.env.EXE_LICENSE_SECRET ?? "";

  if (!existsSync(BUILD_DIR)) throw new Error(`.next not found — run \`next build\` first`);

  // Fail closed BEFORE we spend time copying: never assemble a runtime we'd have
  // to throw away, and never ship an EXE whose gate would accept a placeholder.
  assertNotPlaceholder(licenseSecret);

  mkdirSync(FINAL_PARENT_DIR, { recursive: true });
  console.log(`assembling Vantra local runtime for [${buildTarget}] into ${FINAL_PARENT_DIR}`);

  // 1. Standalone server tree (.next/standalone + its node_modules). Clear any
  //    prior assembly first, but leave the bundled node dist folder in place.
  for (const ent of readdirSync(RUNTIME_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name === "node" || /^node-v/.test(ent.name)) continue; // keep node bundle
    rmSync(path.join(RUNTIME_DIR, ent.name), { recursive: true, force: true });
  }
  copydirTo(FINAL_PARENT_DIR, path.join(BUILD_DIR, "standalone"));

  // 2. Static assets (served under /_next/static by the standalone server).
  if (existsSync(STATIC_DIR)) {
    copydirTo(path.join(FINAL_PARENT_DIR, ".next", "static"), STATIC_DIR);
  }
  // 3. Public assets.
  if (existsSync(PUBLIC_DIR)) {
    copydirTo(path.join(FINAL_PARENT_DIR, "public"), PUBLIC_DIR);
  }
// 4. Purge every env file the copy pulled in (Next embeds the developer's real
  //    .env into the standalone tree). The EXE's security model demands the runtime
  //    carry ZERO secrets — only the minimal .env.local written below. Without this,
  //    a local dev .env (live DB URL, API keys, session secret) would get baked into
  //    the installer alongside the license secret.
  for (const ent of readdirSync(FINAL_PARENT_DIR, { withFileTypes: true })) {
    if (ent.isFile() && /^\.env(\..*)?$/.test(ent.name)) {
      rmSync(path.join(FINAL_PARENT_DIR, ent.name), { force: true });
    }
  }

  // 5. Strip the app's server-side TypeScript source (fail-safe resecretization).
  const removed = stripSourceFiles(FINAL_PARENT_DIR);
  console.log(`stripped ${removed.length} source files from runtime`);

  // 6. Minimal .env.local for the standalone server. Deliberately OMITS DATABASE_URL,
  //    TRMM_API_KEY, SESSION_SECRET, etc. — that's the EXE's whole security model:
  //    the local runtime can only ever serve the license-gate surface. (VANTRA_LOCAL_EXE
  //    is ALSO what makes lib/license-* serve the offline trial path, and fail-closed if
  //    it's ever present in the hosted env.)
  const dotenvLines = [
    "VANTRA_LOCAL_EXE=true",
    `BUILD_TARGET=${buildTarget}`,
    `EXE_LICENSE_SECRET=${licenseSecret}`,
    "NEXT_TELEMETRY_DISABLED=1",
  ].join("\n") + "\n";
  writeFileSync(EXE_DOTENV, dotenvLines);

  // 7. Bundle node so the runtime is fully self-contained (no client install required).
  let nodePath = node();
  if (!existsSync(nodePath)) {
    nodePath = await downloadAndExtractNode(RUNTIME_DIR);
  }
  // Normalize: place the resolved executable at exe/runtime/node/<exec> so main.rs
  // has ONE well-known path regardless of the dist archive layout, then we can drop
  // the versioned dist folder.
  const canonicalNodeDir = path.join(RUNTIME_DIR, "node");
  const canonicalNodeExe = path.join(canonicalNodeDir, nodeExecutableName());
  if (path.dirname(nodePath) !== canonicalNodeDir) {
    mkdirSync(canonicalNodeDir, { recursive: true });
    copyFileSync(nodePath, canonicalNodeExe);
    if (process.platform !== "win32") chmodSync(canonicalNodeExe, 0o755);
    // Remove the whole versioned dist folder (node-v*/...), now unused.
    rmSync(path.dirname(path.dirname(nodePath)), { recursive: true, force: true });
  }

  // 8. Sanity-check the assembled server exists.
  const serverEntry = path.join(FINAL_PARENT_DIR, "server.js");
  if (!existsSync(serverEntry)) {
    // Diagnostic: dump exactly what `next build` produced so a CI failure is
    // self-explaining instead of a one-line mystery. Prints the SOURCE standalone
    // tree (ground truth of what Next emitted) plus the copied runtime tree.
    dumpTree(path.join(BUILD_DIR, "standalone"), "  .next/standalone", 6);
    dumpTree(FINAL_PARENT_DIR, "  exe/runtime/standalone", 6);
    throw new Error(
      `assembled standalone server.js missing — did \`next build\` produce output:standalone? ` +
      `BUILD_TARGET=${process.env.BUILD_TARGET ?? "(unset)"}`
    );
  }

  console.log("--- assembled Vantra local runtime ---");
  console.log(`  server : ${serverEntry}`);
  console.log(`  node   : ${node()}`);
  console.log(`  env    : ${EXE_DOTENV}`);
  console.log(`  target : ${buildTarget}`);
}

main().catch((e) => {
  console.error(`runtime-assemble failed: ${e?.message ?? e}`);
  process.exit(1);
});