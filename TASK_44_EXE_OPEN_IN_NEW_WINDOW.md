# Task — "Open in new tab" silently does nothing inside the desktop EXE

**Status: must land before the EXE is considered done/shipped to real customers** — flagged by the owner explicitly so it isn't lost while Cline is mid-flight on Task 44.4 (local DB / sync). Not urgent relative to that work, but don't let this get forgotten before calling the EXE finished.

## Confirmed bug (verified against Tauri's actual source, not guessed)

The "Open in new tab" button (`components/remote-tools.tsx`'s `openControlInNewTab()`) calls plain `window.open(...)`. In a normal browser this opens a real tab. **Inside the packaged Tauri EXE, it currently does nothing at all** — no window, no tab, no visible effect.

Why, confirmed by reading the actual crate source in `~/.cargo/registry/src/.../wry-0.55.1/src/webview2/mod.rs` (`add_NewWindowRequested` handler, ~line 702) and `~/.cargo/registry/src/.../tauri-2.11.5/src/webview/mod.rs` (`on_new_window`, ~line 585):

- WebView2 fires an internal `NewWindowRequested` event whenever script calls `window.open(...)`.
- Tauri only creates a new window from that event if the app explicitly registered a handler via `.on_new_window(...)` on the `WebviewBuilder` **before the webview was built**.
- Vantra's `src-tauri/src/main.rs` never calls `.on_new_window(...)` anywhere (confirmed — grepped the whole file). Its main window is created automatically from `tauri.conf.json`'s declarative `"windows"` array via plain `tauri::Builder::default()`, never manually built.
- Without a registered handler, wry's own code does `args.SetHandled(true)` and stops — the request is silently swallowed. This is exactly what's happening.

## The fix

Do **not** hand off to the user's system default browser — a desktop-mode user likely isn't logged into the web there at all (their whole session lives inside the app via the license key + local runtime, not a browser cookie), so an external browser would just show a login wall for something the app itself is already authenticated for.

Instead: register `on_new_window` to spawn a **genuine second native app window**, using Tauri's documented pattern (`tauri-2.11.5/src/webview/mod.rs`'s own doc example for `on_new_window`, and `WebviewWindowBuilder::from_config` at ~line 150 of `tauri-2.11.5/src/webview/webview_window.rs`, which builds a webview window starting from the SAME config as `tauri.conf.json`'s declared window — the same window the app already uses today, just re-created for a second instance with a new label and the popup's target URL). Concretely, in `main.rs`'s `.setup()` (around line 125-140, where the main window is currently just fetched via `app.get_webview_window("main")`), the main window needs to move from purely-declarative creation to explicit construction so `.on_new_window(...)` can be attached before `.build()`:

```rust
// Illustrative shape, not exact code to paste verbatim -- confirm the
// precise builder chain against the live tauri-2.11.5 API when implementing.
let webview_window = tauri::WebviewWindowBuilder::from_config(
    app,
    app.config().app.windows.get(0).unwrap(),
)?
.on_new_window(move |url, features| {
    // Give each popped-out window a unique label -- Tauri rejects two
    // windows sharing a label.
    let label = format!("popup-{}", nanoid_or_counter());
    let builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        tauri::WebviewUrl::External(url),
    )
    .window_features(features);
    match builder.build() {
        Ok(window) => tauri::webview::NewWindowResponse::Create { window },
        Err(_) => tauri::webview::NewWindowResponse::Deny,
    }
})
.build()?;
```

Two things to get right, not just copy blindly:

1. **Uniqueness**: Tauri refuses two windows with the same label — generate a fresh label per popup (a counter or random suffix), not a fixed string.
2. **No deadlock risk**: wry's own `NewWindowRequested` handler already defers execution via `dispatch_handler` (scheduled on the message loop after the callback returns) specifically so calling `.build()` synchronously inside `on_new_window`'s closure is safe on Windows — this is confirmed in the wry source, not something the implementation needs to work around itself.

## Explicitly out of scope

- Don't touch how the main window's OWN creation/navigation to the license gate or local/hosted surfaces works — this only adds the popup-window capability alongside it.
- Don't route through the system browser — see "why not" above.

## Verification required before calling this done

Real Windows VM test (same bar as every other EXE change this session): inside the installed, launched EXE, navigate to a device's remote console and click "Open in new tab." A second native app window must actually appear, showing the console page, not nothing and not a system-browser tab.
