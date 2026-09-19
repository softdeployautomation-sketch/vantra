// Prevents an extra console window on Windows in release builds, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Vantra — Tauri application shell (Task 44.3). Desktop binary.
//
// Thin license-gate runtime, Option 2 architecture: this shell bundles ONLY the
// local license/settings surface (the minimal Next.js runtime under exe/runtime/)
// and then points the window at the hosted app (https://vantra.instaweb.top) for
// everything else. The local runtime can never reach a production database — it is
// packed with a minimal .env.local containing only EXE_LICENSE_SECRET +
// VANTRA_LOCAL_EXE (see scripts/runtime-assemble.mjs) — so nothing secret ever
// ships in the unpacked tree.
//
//   dev (tauri dev / debug_assertions): window loads `devUrl` directly — the
//       `next dev` server started by beforeDevCommand (scripts/run-exe-dev.sh).
//   prod (tauri build / release):      spawns `runtime/node server.js`, waits for
//       http://127.0.0.1:<LOCAL_PORT>, then navigates the main window there.
//
// Once the local gate approves/expires a license, the client component
// (components/exe-gate.tsx) navigates the window to the hosted app. The child is
// killed when the window closes.

use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{Manager, Url};

/// Dedicated loopback port the bundled Next.js runtime serves the gate on.
const LOCAL_PORT: u16 = 34513;

/// The spawned local-runtime child process — killed when the window closes.
struct LocalRuntime(Mutex<Option<Child>>);

/// Platform-appropriate name for the bundled Node binary (see runtime-assemble.mjs).
fn node_name() -> String {
    let mut name = String::from("node");
    if cfg!(target_os = "windows") {
        name.push_str(".exe");
    }
    name
}

fn find_runtime_dir(resource_dir: &Path) -> Option<std::path::PathBuf> {
    // Tauri v2 stages `bundle.resources` into the per-OS resource root, but the
    // exact layout varies by platform/packager (e.g. a `../exe/runtime` source
    // can land at `_up_/exe/runtime` on macOS, `exe/runtime` elsewhere). Locate
    // it by probing for the marker file instead of betting on one layout.
    let candidates = [
        resource_dir.join("runtime"),
        resource_dir.join("exe").join("runtime"),
        resource_dir.join("_up_").join("runtime"),
        resource_dir.join("_up_").join("exe").join("runtime"),
    ];
    candidates
        .into_iter()
        .find(|c| c.join("standalone").join("server.js").exists())
}

/// Locates the bundled node executable under `runtime_dir`. runtime-assemble.mjs
/// canonically places it at `<runtime_dir>/node/<node_name>` (a dedicated `node`
/// subdirectory — see its `canonicalNodeDir`), not directly under `runtime_dir`.
/// A confirmed real bug: this used to look for `runtime_dir/node.exe` (missing
/// the `node` subdirectory), so the bundled runtime was never found and the app
/// silently failed to launch the local server on every real Windows install.
/// Probing both, newest layout first, matches this file's existing defensive
/// style (see `find_runtime_dir`) in case the assembler's layout shifts again.
fn find_node_binary(runtime_dir: &Path) -> Option<std::path::PathBuf> {
    let name = node_name();
    [runtime_dir.join("node").join(&name), runtime_dir.join(&name)]
        .into_iter()
        .find(|p| p.exists())
}

/// Spawns the bundled Next.js standalone server with the bundled Node runtime.
fn spawn_local_runtime(resource_dir: &Path) -> Option<Child> {
    let runtime_dir = find_runtime_dir(resource_dir)?;
    let standalone = runtime_dir.join("standalone");
    let Some(node) = find_node_binary(&runtime_dir) else {
        eprintln!(
            "Vantra: bundled node executable missing under {} (checked node/{name} and {name})",
            runtime_dir.display(),
            name = node_name(),
        );
        return None;
    };
    if !standalone.join("server.js").exists() {
        eprintln!(
            "Vantra: bundled runtime missing (expected {})",
            standalone.join("server.js").display()
        );
        return None;
    }

    let mut cmd = Command::new(&node);
    cmd.arg("server.js")
        .current_dir(&standalone)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", LOCAL_PORT.to_string())
        .env("NODE_ENV", "production");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no extra console window
    }

    cmd.spawn().ok()
}

/// Polls until the runtime is accepting connections on LOCAL_PORT.
fn wait_for_runtime(period: Duration, attempts: u32) -> bool {
    for _ in 0..attempts {
        if TcpStream::connect(("127.0.0.1", LOCAL_PORT)).is_ok() {
            return true;
        }
        thread::sleep(period);
    }
    false
}

/// Prevents two popup windows from ever sharing a label — Tauri rejects a
/// second window with an existing label. Combined with the process id in the
/// label, this is also unique across restarts, and monotonically counts up so
/// repeatedly popping out consoles never collides.
static POPUP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Opens `url` in the user's real system default browser — for genuinely
/// external (non-Vantra) links, where an extra native app window (no back
/// button, no bookmarks, no session reason to exist) is worse than handing
/// off entirely. Best-effort: a failure here just means the link silently
/// doesn't open, matching how a failed window.open() already behaves.
fn open_in_system_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(LocalRuntime(Mutex::new(None)))
        .setup(|app| {
            // The `main` window is declared in tauri.conf.json with `"create":
            // false`, so Tauri does NOT auto-create it — we build it explicitly
            // here so `.on_new_window(...)` can be attached before `.build()`.
            // That registration is the whole point of TASK_44_EXE_OPEN_IN_NEW_WINDOW.md:
            // without it, wry swallows WebView2's `NewWindowRequested` event (the
            // internal event `window.open` fires), so "Open in new tab" silently
            // did nothing inside the packaged EXE. The popup is a real second
            // native app window running the app's own authenticated session — NOT
            // the system browser, which would show a login wall to a desktop user
            // whose whole session lives inside the app.
            let app_handle = app.handle().clone();
            let main_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("main window config missing");
            let main_window = tauri::WebviewWindowBuilder::from_config(&app_handle.clone(), main_config)?
                .on_new_window(move |url, features| {
                    // Real bug, confirmed live (2026-09-19): this handler used to
                    // fire for EVERY window.open() call, including genuinely
                    // external, third-party links (Connect Telegram's t.me deep
                    // link, the EXE download URL) — each got its own extra native
                    // Tauri window, with no back button, no bookmarks, and no
                    // Vantra session reason to exist (the ORIGINAL reasoning below
                    // only ever applied to popping out another VANTRA page, where
                    // the system browser's separate cookie jar would show a login
                    // wall). Only keep the in-app-popup path for Vantra's own
                    // domain; hand everything else to the user's real system
                    // browser instead.
                    let is_internal = url
                        .host_str()
                        .map(|h| h == "vantra.instaweb.top" || h == "127.0.0.1" || h == "localhost")
                        .unwrap_or(false);
                    if !is_internal {
                        open_in_system_browser(url.as_str());
                        return tauri::webview::NewWindowResponse::Deny;
                    }

                    // Give every popped-out window a unique label.
                    let n = POPUP_COUNTER.fetch_add(1, Ordering::Relaxed);
                    let label = format!("popup-{}-{}", std::process::id(), n);
                    let builder = tauri::WebviewWindowBuilder::new(
                        &app_handle,
                        label,
                        // `window.open(...)` supplies an already-resolved absolute
                        // URL — for the hosted app that's https://vantra.instaweb.top.
                        // The popup is a real second native app window running the
                        // app's own authenticated session — NOT the system browser,
                        // which would show a login wall to a desktop user whose
                        // whole session lives inside the app.
                        tauri::WebviewUrl::External(url),
                    )
                    .window_features(features);
                    match builder.build() {
                        Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                        Err(_) => tauri::webview::NewWindowResponse::Deny,
                    }
                })
                .build()?;

            if !cfg!(debug_assertions) {
                // Production: spawn the bundled runtime, then point the window at
                // the local license gate once it answers. Doing the wait on a
                // background thread keeps setup snappy — the window shows the
                // splash placeholder meanwhile.
                let res_dir = app.path().resource_dir().expect("resource dir missing");
                let child = spawn_local_runtime(&res_dir);
                *app.state::<LocalRuntime>().0.lock().unwrap() = child;

                let win = main_window;
                thread::spawn(move || {
                    if wait_for_runtime(Duration::from_millis(300), 150) {
                        let url = Url::parse(&format!(
                            "http://127.0.0.1:{}/exe",
                            LOCAL_PORT
                        ))
                        .expect("invalid local url");
                        let _ = win.navigate(url);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(mut child) = window.state::<LocalRuntime>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Vantra");
}