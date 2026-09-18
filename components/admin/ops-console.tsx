"use client";

import { Columns2, Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";

import { PlatformStatusTiles } from "@/components/admin/platform-status";
import { cn } from "@/lib/cn";

// Unified Ops Console — the single place to manage BOTH products that share this
// box (Vantra, this app, and SpaceWorker, a separate Next.js app on the same VPS
// whose admin panel gets embedded via iframe). The shell is deliberately neutral
// ("control room", monospace accents for status/hostnames) rather than Vantra's
// indigo or SpaceWorker's amber — it manages both, so it reads as belonging to
// neither one's brand.
//
// STATE PRESERVATION IS THE WHOLE POINT. Both panels stay mounted for the life of
// this component. Switching Vantra / Split / SpaceWorker, or expanding/collapsing
// a panel in Split mode, only ever changes the two grid-column track widths
// (1fr/1fr split, or one side 0fr + the other 1fr with overflow hidden). The
// SpaceWorker iframe is never unmounted, so it never reloads and never loses its
// scroll position or in-frame state. Layout is 100% CSS, zero re-mounting.

type View = "vantra" | "split" | "spaceworker";
type PanelKey = "vantra" | "spaceworker";

const VIEWS: { key: View; label: string }[] = [
  { key: "vantra", label: "Vantra" },
  { key: "split", label: "Split" },
  { key: "spaceworker", label: "SpaceWorker" },
];

interface ColumnWidths {
  vantra: string;
  spaceworker: string;
}

function columnWidths(view: View, expanded: PanelKey | null): ColumnWidths {
  if (view === "vantra") return { vantra: "1fr", spaceworker: "0fr" };
  if (view === "spaceworker") return { vantra: "0fr", spaceworker: "1fr" };
  // Split mode. An expanded panel takes the full width; the other collapses to
  // a 0fr track (kept mounted, just hidden via overflow) so its state survives.
  if (expanded === "vantra") return { vantra: "1fr", spaceworker: "0fr" };
  if (expanded === "spaceworker") return { vantra: "0fr", spaceworker: "1fr" };
  return { vantra: "1fr", spaceworker: "1fr" };
}

const PANEL_META: Record<
  PanelKey,
  { title: string; hostname: string; dot: string }
> = {
  vantra: {
    title: "Vantra",
    hostname: "vantra.instaweb.top",
    dot: "bg-emerald-400",
  },
  spaceworker: {
    title: "SpaceWorker",
    hostname: "spaceworker.instaweb.top",
    dot: "bg-sky-400",
  },
};

export function OpsConsole() {
  const [view, setView] = useState<View>("split");
  const [expanded, setExpanded] = useState<PanelKey | null>(null);

  const widths = columnWidths(view, expanded);
  const inSplit = view === "split";

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-sm">
      {/* Top bar — wordmark, segmented switcher, live reachability. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-bg-elevated px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-tight text-fg">
            Ops Console
          </span>
          <span className="hidden font-mono text-[11px] text-fg-muted sm:inline">
            {inSplit
              ? expanded
                ? "focused"
                : "split view"
              : view === "vantra"
                ? "vantra only"
                : "spaceworker only"}
          </span>
        </div>

        <div
          className="flex items-center rounded-lg bg-black/5 p-1 dark:bg-white/5"
          role="tablist"
          aria-label="Platform view"
        >
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => {
                setView(v.key);
                // Leaving Split ushers the other side back to its natural, shared
                // split width; Expand only has meaning while Split is active.
                if (v.key !== "split") setExpanded(null);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === v.key
                  ? "bg-bg-elevated text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <ReachabilityIndicator />
      </div>

      {/* Two always-mounted panels; only the column widths change. */}
      <div
        className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out"
        style={{ gridTemplateColumns: `${widths.vantra} ${widths.spaceworker}` }}
      >
        <Panel
          panel="vantra"
          view={view}
          expanded={expanded}
          onToggleExpand={() =>
            setExpanded((cur) => (cur === "vantra" ? null : "vantra"))
          }
        >
          <div className="flex-1 overflow-y-auto p-4">
            <PlatformStatusTiles />
          </div>
        </Panel>

        <Panel
          panel="spaceworker"
          view={view}
          expanded={expanded}
          onToggleExpand={() =>
            setExpanded((cur) => (cur === "spaceworker" ? null : "spaceworker"))
          }
        >
          <div className="flex-1 overflow-hidden">
            <iframe
              // ?theme=dark forces SpaceWorker's own theme script (app/layout.tsx)
              // to skip its own localStorage read entirely -- without it, a
              // backgrounded-tab iframe reload (the browser's own doing, not
              // ours; SpaceWorker's own storage can end up stale/partitioned)
              // could silently repaint this panel in a different theme than the
              // rest of the console on return.
              src="https://spaceworker.instaweb.top/admin?theme=dark"
              title="SpaceWorker admin console"
              className="h-full w-full border-0 bg-zinc-950"
              // No sandbox attribute: SpaceWorker is a fully trusted first-party
              // app the owner controls, and a restrictive sandbox could break its
              // passcode login / forms / session cookies. No allow-top-navigation
              // anywhere — the frame is purely embedded content.
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
function Panel({
  panel,
  view,
  expanded,
  onToggleExpand,
  children,
}: {
  panel: PanelKey;
  view: View;
  expanded: PanelKey | null;
  onToggleExpand: () => void;
  children: React.ReactNode;
}) {
  const meta = PANEL_META[panel];
  const isExpanded = expanded === panel;
  const showExpand = view === "split";

  return (
    <section
      aria-label={`${meta.title} panel`}
      className="flex min-w-0 flex-col overflow-hidden"
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg-elevated px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)}
            aria-hidden
          />
          <span className="text-sm font-semibold text-fg">{meta.title}</span>
          <span className="truncate font-mono text-xs text-fg-muted">
            {meta.hostname}
          </span>
        </div>

        {showExpand &&
          (isExpanded ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-black/5 hover:text-fg dark:hover:bg-white/5"
            >
              <Columns2 className="h-3.5 w-3.5" />
              Back to split
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-black/5 hover:text-fg dark:hover:bg-white/5"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Expand
            </button>
          ))}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

interface Reachability {
  vantra?: boolean;
  spaceworker?: boolean;
}

function ReachabilityIndicator() {
  const [status, setStatus] = useState<Reachability>({});

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/status");
        const data = await res.json();
        if (active && data && typeof data.platform === "object") {
          setStatus(data.platform as Reachability);
        }
      } catch {
        // Leave the current state; the next poll retries.
      }
    }
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center gap-4 font-mono text-[11px] text-fg-muted">
      <ReachDot label="VAN" state={status.vantra} />
      <ReachDot label="SW" state={status.spaceworker} />
    </div>
  );
}

function ReachDot({ label, state }: { label: string; state?: boolean }) {
  const tone =
    state === undefined ? "bg-gray-400" : state ? "bg-emerald-500" : "bg-red-500";
  const text = state === undefined ? "checking" : state ? "up" : "down";
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", tone)} aria-hidden />
      <span>
        {label} {text}
      </span>
    </span>
  );
}