"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

// The EXE's in-app tab workspace. Built to replace native multi-window
// popups (Tauri's on_new_window, added for "Open in new tab") after a real
// test showed a blank white window and no way back to the dashboard —
// separate OS windows also have no natural "go back and open more devices"
// affordance. This keeps everything inside the ONE Tauri window instead:
// a Dashboard tab (always open, never closes) plus one tab per opened
// device console, all switchable, all kept MOUNTED while inactive (hidden
// via CSS, not unmounted) so a device's live console doesn't reload/
// reconnect every time you switch away and back — same technique already
// proven in this app for MeshCentral iframes and components/tabs.tsx.
//
// A tab's content is a same-origin iframe. remote-tools.tsx's "Open in new
// tab" posts a message UP to this shell (window.top.postMessage) instead of
// calling window.open() when it detects it's running inside an iframe (i.e.
// inside a workspace tab) — see openControlInNewTab there.
//
// Loading state + stall fallback (2026-09-19) — confirmed live: a tab's
// iframe blanked out mid-login with no spinner and no way to recover short
// of killing the whole app. Every tab now shows a spinner until its iframe's
// onLoad fires at least once, and if that takes too long, a "still loading —
// Reload" fallback so a genuine stall is always visibly recoverable in-app.

interface WorkspaceTab {
  id: string; // "dashboard" or a TRMM agent_id
  title: string;
  src: string;
  closable: boolean;
}

const DASHBOARD_TAB: WorkspaceTab = {
  id: "dashboard",
  title: "Dashboard",
  src: "/dashboard",
  closable: false,
};

// How long a tab can sit without its iframe firing onLoad before the
// "still loading" fallback (with a Reload button) appears.
const STALL_TIMEOUT_MS = 12_000;

export function WorkspaceShell() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([DASHBOARD_TAB]);
  const [activeId, setActiveId] = useState("dashboard");
  // Per-tab load state: "loading" until onLoad fires once, "stalled" if
  // STALL_TIMEOUT_MS passes first, "loaded" once onLoad has fired. A reload
  // (bumping reloadNonce) resets a tab back to "loading".
  const [tabStatus, setTabStatus] = useState<Record<string, "loading" | "stalled" | "loaded">>({
    dashboard: "loading",
  });
  const [reloadNonce, setReloadNonce] = useState<Record<string, number>>({});
  const stallTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const armStallTimer = useCallback((id: string) => {
    clearTimeout(stallTimers.current[id]);
    stallTimers.current[id] = setTimeout(() => {
      setTabStatus((prev) => (prev[id] === "loaded" ? prev : { ...prev, [id]: "stalled" }));
    }, STALL_TIMEOUT_MS);
  }, []);

  // Arm the dashboard tab's own stall timer on first mount (every other tab
  // arms its timer when it's first added, below).
  useEffect(() => {
    armStallTimer("dashboard");
    const timers = stallTimers.current;
    return () => clearTimeout(timers.dashboard);
  }, [armStallTimer]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Same-origin only — this shell and every tab it embeds are all
      // vantra.spaceworker.top, so a message from anywhere else is never ours.
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; agentId?: string; title?: string } | null;
      if (!data || data.type !== "vantra:open-device-tab" || !data.agentId) return;

      const { agentId, title } = data;
      setTabs((prev) => {
        if (prev.some((t) => t.id === agentId)) return prev; // already open — just focus it, don't duplicate
        setTabStatus((s) => ({ ...s, [agentId]: "loading" }));
        armStallTimer(agentId);
        return [
          ...prev,
          {
            id: agentId,
            title: title?.trim() || agentId,
            src: `/console/${encodeURIComponent(agentId)}`,
            closable: true,
          },
        ];
      });
      setActiveId(agentId);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [armStallTimer]);

  // Reads `tabs`/`activeId` from the render closure rather than a functional
  // update — this is a plain synchronous click handler, not something racing
  // another state update, so there's no staleness risk, and computing both
  // the next tab list AND the next active id from the SAME snapshot avoids a
  // real bug functional updates would introduce here: two separate setState
  // calls would have the second one's "prev" already reflect the first's
  // filtered result, breaking the closed tab's index lookup.
  const closeTab = useCallback(
    (id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      clearTimeout(stallTimers.current[id]);
      delete stallTimers.current[id];
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next.length > 0 ? next : [DASHBOARD_TAB]);
      if (activeId === id) {
        const fallback = tabs[idx - 1] ?? tabs[idx + 1] ?? DASHBOARD_TAB;
        setActiveId(fallback.id);
      }
    },
    [tabs, activeId],
  );

  function handleLoad(id: string) {
    clearTimeout(stallTimers.current[id]);
    setTabStatus((prev) => ({ ...prev, [id]: "loaded" }));
  }

  function reloadTab(id: string) {
    setTabStatus((prev) => ({ ...prev, [id]: "loading" }));
    setReloadNonce((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    armStallTimer(id);
  }

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <div
        role="tablist"
        aria-label="Open workspace tabs"
        className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-bg-elevated px-2"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-sm",
                isActive
                  ? "bg-bg font-medium text-fg"
                  : "text-fg-muted hover:bg-black/5 dark:hover:bg-white/5",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(tab.id)}
                className="max-w-[180px] truncate"
                title={tab.title}
              >
                {tab.title}
              </button>
              {tab.closable && (
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => closeTab(tab.id)}
                  className="shrink-0 rounded text-fg-muted opacity-0 hover:bg-black/10 group-hover:opacity-100 dark:hover:bg-white/10"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const status = tabStatus[tab.id] ?? "loading";
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn("absolute inset-0", isActive ? "block" : "hidden")}
            >
              <iframe
                key={`${tab.id}-${reloadNonce[tab.id] ?? 0}`}
                src={tab.src}
                title={tab.title}
                onLoad={() => handleLoad(tab.id)}
                className="absolute inset-0 h-full w-full border-0"
              />
              {status !== "loaded" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand-600" />
                  {status === "stalled" && (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <p className="text-sm text-fg-muted">
                        {tab.title} is taking longer than expected to load.
                      </p>
                      <button
                        type="button"
                        onClick={() => reloadTab(tab.id)}
                        className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm font-medium text-fg hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        Reload
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
