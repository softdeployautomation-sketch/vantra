"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog, Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Card, Input, Select, Spinner, Td, Th, Table } from "@/components/ui";
import { Backstage } from "@/components/backstage";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/relative-time";

// A single action shown in the post-connect "Tools" menu. The menu is fully
// data-driven: future post-connect tools are added by appending an entry to the
// array passed to <PostConnectMenu> — no per-action JSX or hardcoded buttons.
interface PostConnectAction {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect: () => void;
}

// A command queued against an offline device, to fire the next time it comes
// online (Task 18). Structural copy of the server's QueuedAgentCommand — the
// client can't import server-only Prisma types, so keep this in sync by hand.
interface QueuedCommand {
  id: string;
  shell: "cmd" | "powershell";
  cmd: string;
  timeoutSeconds: number;
  runAsUser: boolean;
  status: "queued" | "sent" | "failed" | "cancelled";
  createdAt: string;
  sentAt?: string | null;
  error?: string | null;
}

// Custom maintenance-overlay image policy (mirrors the server's 2MB cap and
// allowlist so a bad file is rejected before it's uploaded, not after).
const MAX_OVERLAY_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_OVERLAY_EXTS = ["png", "jpg", "jpeg", "gif"] as const;

// Reads a File into a base64 string (strips the data: URI prefix) via FileReader.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.readAsDataURL(file);
  });
}

/**
 * Data-driven dropdown of post-connect tools. First entry is the maintenance
 * overlay (start/stop). Structured as a list of actions so it can accept any
 * number of future post-connect tools without structural changes.
 */
function PostConnectMenu({ actions }: { actions: PostConnectAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="secondary"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Tools
        <svg
          aria-hidden
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
      {open && (
        <>
          {/* Invisible backdrop: closes the menu on any outside click. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg"
          >
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={() => {
                  a.onSelect();
                  setOpen(false);
                }}
                className={cn(
                  "block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60",
                )}
              >
                <span className="block text-sm font-medium text-fg">{a.label}</span>
                {a.description && (
                  <span className="mt-0.5 block text-xs text-fg-muted">{a.description}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// A single pre-connect option on the Control tab. The chooser shows EXACTLY
// three of these — nothing else — per the redesign requirement.
function ConnectOption({
  title,
  description,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated p-4 text-left transition-colors hover:border-brand-500 hover:bg-brand-500/10 disabled:opacity-50 disabled:pointer-events-none"
    >
      <span>
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>
      </span>
      <span aria-hidden className="text-fg-muted">
        →
      </span>
    </button>
  );
}

/**
 * The Control tab's pre-connect state: exactly three connect options, nothing
 * else. Picking one transitions the tab into the corresponding session (full
 * desktop / view-only / Backstage).
 */
function ConnectChooser({
  controlAvailable,
  onFullControl,
  onViewOnly,
  onBackend,
}: {
  controlAvailable: boolean;
  onFullControl: () => void;
  onViewOnly: () => void;
  onBackend: () => void;
}) {
  return (
    <div className="mt-4">
      <h4 className="text-sm font-bold text-fg">Connect to this device</h4>
      <p className="mt-0.5 text-xs text-fg-muted">
        Choose how you want to connect. You can switch modes or disconnect after
        connecting.
      </p>
      <div className="mt-4 grid gap-3">
        <ConnectOption
          title="Connect to device"
          description="Full remote-desktop session with full control of the machine."
          disabled={!controlAvailable}
          onClick={onFullControl}
        />
        <ConnectOption
          title="Connect with input suspended"
          description="Watch the screen live with your (the technician's) input off. You can resume input at any time from the Tools menu."
          disabled={!controlAvailable}
          onClick={onViewOnly}
        />
        <ConnectOption
          title="Connect to Backend"
          description="Open Backstage admin tooling — services, processes and installed software — instead of the desktop view. Run a command? Use the Terminal section further down this page."
          onClick={onBackend}
        />
      </div>
    </div>
  );
}

export function RemoteTools({ agentId }: { agentId: string }) {
  const toast = useToast();
  const [mesh, setMesh] = useState<Record<string, string> | null>(null);
  const [meshLoading, setMeshLoading] = useState(true);
  const [meshError, setMeshError] = useState<string | null>(null);
  // Reordered 2026-09-03: Terminal is the default/first tab, Files stays in the
  // middle, Control is last (per the redesign task — "Terminal first, Control
  // last").
  //
  // Task 18 (2026-09-08): "terminal" removed from the tab bar entirely — the
  // Terminal command runner is now its own always-visible top-level section
  // below this card, not a MeshCentral iframe tab here. What remains in the
  // Remote access card is the actual remote-view: Files (MeshCentral file view,
  // Phase 2 territory), and Control (desktop). Default is Control now that
  // Terminal no longer forces the iframe on page load.
  const [activeTab, setActiveTab] = useState<"file" | "control">("control");

  const [cmd, setCmd] = useState("");
  const [shell, setShell] = useState<"cmd" | "powershell">("cmd");
  const [timeout, setTimeoutVal] = useState(30);
  const [runAsUser, setRunAsUser] = useState(false);
  const [cmdOutput, setCmdOutput] = useState("");
  const [cmdLoading, setCmdLoading] = useState(false);

  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [showOverlayChooser, setShowOverlayChooser] = useState(false);
  const [overlayToStop, setOverlayToStop] = useState(false);
  const [pendingCustomImage, setPendingCustomImage] = useState<{
    base64: string;
    ext: string;
    name: string;
  } | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  // Task 18 — queue-until-online. `deviceOnline` decides which action the Run
  // button performs (live vs queue); it's fetched independently so the card is
  // usable without first loading system info. `queuedCommands` backs the
  // "Queued commands" list shown below the Run form.
  const [deviceOnline, setDeviceOnline] = useState(true);
  const [queuedCommands, setQueuedCommands] = useState<QueuedCommand[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Loads the caller's own queued commands for this agent. useCallback keeps a
  // stable identity (deps: only agentId) so the mount effect below can depend on
  // it without re-firing every render. It's also called after queue/cancel to
  // refresh the list.
  const loadQueuedCommands = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/queue-command`,
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) setQueuedCommands(data.commands ?? []);
    } catch {
      // Non-fatal: keep whatever was already shown rather than erroring the card.
    }
  }, [agentId]);

  useEffect(() => {
    fetch(`/api/devices/${encodeURIComponent(agentId)}/mesh`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMesh(d.urls ?? null))
      .catch(() => setMeshError("Couldn't load remote-access details."))
      .finally(() => setMeshLoading(false));
  }, [agentId]);

  // Task 18 — the standalone Terminal section needs to know whether the device
  // is reachable (to pick "Run now" vs "Queue until online") and show the
  // device's queued commands. The device GET is ownership-gated but not
  // premium-gated, so it's safe for the Remote Tools (premium) page to read.
  useEffect(() => {
    fetch(`/api/devices/${encodeURIComponent(agentId)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((d) => setDeviceOnline(d?.agent?.status === "online"))
      .catch(() => {
        /* default true; a live Run will surface an offline error anyway */
      });
    // Load this device's queued commands. Deferred through a .then callback
    // (like the status fetch just above) so the state update happens outside the
    // effect body's synchronous scope — satisfying react-hooks/set-state-in-effect.
    fetch(`/api/devices/${encodeURIComponent(agentId)}/queue-command`)
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (d?.commands) setQueuedCommands(d.commands);
      })
      .catch(() => {
        /* non-fatal; queueCommand/cancelQueued will refresh if needed */
      });
  }, [agentId]);

  // REVISED 2026-09-03 per direct user correction — full control is the
  // default, nothing restricts input automatically. The technician gets a
  // real-time, low-latency operational view from the moment they connect
  // (customers may be watching the fix happen live — no added round-trips on
  // the default path). "View-only" is an explicit, admin-invoked action for
  // when they want to safely observe without risk of input reaching the
  // device, not a default posture.
  //
  // 2026-09-03 redesign — the Control tab now starts at a pre-connect chooser
  // (connectMode === "choose") offering EXACTLY three connect options. Picking
  // one enters a session: "control" (full desktop), "viewonly" (the
  // technician's OWN input taken off — per the task's vocabulary note this is
  // the technician's remote input, never the guest's/device-owner's local
  // input), or "backend" (embeds the Backstage admin panel in place of the
  // desktop iframe). Modes can be switched mid-session from the toolbar, and
  // Disconnect returns to the chooser.
  type ConnectMode = "choose" | "control" | "viewonly" | "backend";
  const [connectMode, setConnectMode] = useState<ConnectMode>("choose");
  // "Open in new tab" used to leave the embedded iframe's own connection alive
  // too, so the remote desktop ended up with two independent MeshCentral
  // viewer sessions running against it at once. Tracking this stops the
  // embedded iframe once the technician has popped the session out.
  const [poppedOut, setPoppedOut] = useState(false);
  const controlUrl = mesh?.control ?? null;

  // PERFORMANCE: fetched lazily from a separate endpoint, NOT baked into the
  // base `mesh` fetch above, and NOT fetched just because the Control tab is
  // open — only once the technician explicitly picks the input-off connect
  // option. This component mounts on every device-detail page load
  // (components/tabs.tsx keeps all tabs mounted, hidden via CSS), so eagerly
  // minting a real MeshCentral share link (~2 websocket round-trips) on every
  // page load — or even on every Control-tab view — was a real, measured
  // regression, found and fixed 2026-09-03. It now only fires on the admin's
  // own explicit request.
  const [viewOnlyUrl, setViewOnlyUrl] = useState<string | null>(null);
  // Fetched at most once per component lifetime regardless of how many times
  // the technician toggles view-only on/off — a ref keeps the link cached
  // without needing a synchronous setState inside the effect (which the
  // react-hooks/set-state-in-effect rule forbids — the original code tripped
  // that rule with its eager "loading" setState).
  const viewOnlyRequestedRef = useRef(false);
  useEffect(() => {
    if (connectMode !== "viewonly" || viewOnlyRequestedRef.current) return;
    viewOnlyRequestedRef.current = true;
    let cancelled = false;
    fetch(`/api/devices/${encodeURIComponent(agentId)}/mesh/view-only`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setViewOnlyUrl(d.controlViewOnly ?? null);
      })
      .catch(() => {
        if (!cancelled) setViewOnlyUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectMode, agentId]);

  const realViewOnlyBlock =
    activeTab === "control" && connectMode === "viewonly" && !!viewOnlyUrl;
  const softGuard =
    activeTab === "control" &&
    connectMode === "viewonly" &&
    !!controlUrl &&
    !viewOnlyUrl;
  // Full-control starts by default; view-only prefers the real protocol-level
  // view-only URL when one could be minted, otherwise the Control URL is used
  // underneath the client-side soft guard.
  const controlSrc = realViewOnlyBlock ? viewOnlyUrl : controlUrl;

  // Strictly separated src sources: Files resolves to its own MeshCentral view
  // (mesh.file) and NEVER to the Control desktop. Control resolves to
  // controlSrc above. Terminal no longer has a src here — it's now a standalone
  // command-runner section, not an iframe (Task 18).
  const fileSrc = activeTab === "file" ? (mesh?.file ?? null) : null;

  // Defensive remount (second half of that fix): keying the iframe by view
  // guarantees a fresh frame that navigates to the new src, so no stale frame
  // content can leak across tab/session switches even if src-selection were
  // ever regressed.
  const iframeKey =
    activeTab === "control" ? `control-${connectMode}` : `view-${activeTab}`;

  // Part C — remote sessions open in their own browser tab (so a technician can
  // keep several devices open across tabs). The right-click context menu already
  // does this via window.open(url, "_blank", "noopener","noreferrer"); this
  // exposes the same for the embedded Control view.
  function openControlInNewTab() {
    const url = mesh && mesh["control"];
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    // Stop the embedded iframe's own connection now that a separate tab owns
    // it — otherwise both stay live and fight over the same remote desktop.
    setPoppedOut(true);
  }

  async function runCommand() {
    if (!cmd.trim()) return;
    setCmdLoading(true);
    setCmdOutput("");
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/cmd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd, shell, timeout, runAsUser }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCmdOutput(`Error: ${data.error ?? res.status}`);
        return;
      }
      setCmdOutput(String(data.output ?? "(no output)"));
    } catch {
      setCmdOutput("Error: network failure.");
    } finally {
      setCmdLoading(false);
    }
  }

  // Task 18 — queue a command to run the next time an offline device comes
  // online. Mirrors the live cmd route's own payload shape; the poller fires it
  // via the SAME sendRawCmd call the live route uses. Clears the form on
  // success and refreshes the queued list so the new entry appears immediately.
  async function queueCommand() {
    if (!cmd.trim()) return;
    setQueueLoading(true);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/queue-command`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd, shell, timeout, runAsUser }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCmdOutput(`Error: ${data.error ?? res.status}`);
        return;
      }
      setCmd("");
      setCmdOutput("");
      toast.push("Command queued — it will run when this device comes online.");
      await loadQueuedCommands();
    } catch {
      setCmdOutput("Error: network failure while queueing.");
    } finally {
      setQueueLoading(false);
    }
  }

  // Cancels a still-queued command before the device comes back online.
  async function cancelQueued(id: string) {
    setCancellingId(id);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/queue-command/${id}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't cancel that command.", "error");
        return;
      }
      toast.push("Queued command cancelled.");
      await loadQueuedCommands();
    } catch {
      toast.push("Network error while cancelling.", "error");
    } finally {
      setCancellingId(null);
    }
  }

  async function setOverlay(
    on: boolean,
    opts?: { customImageBase64: string; customImageExt: string },
  ) {
    setOverlayLoading(true);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/maintenance-overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          opts
            ? { action: on ? "start" : "stop", ...opts }
            : { action: on ? "start" : "stop" },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't update the maintenance overlay.", "error");
        return;
      }
      setOverlayOn(on);
      toast.push(on ? "Maintenance overlay started." : "Maintenance overlay stopped.");
    } catch {
      toast.push("Network error while updating the overlay.", "error");
    } finally {
      setOverlayLoading(false);
      setShowOverlayChooser(false);
      setOverlayToStop(false);
    }
  }

  // Custom overlay asset chooser — validates type/size client-side (mirroring
  // the server) and reads the file into a base64 string for the API payload.
  function handleCustomFileChange(file: File | undefined) {
    if (!file) {
      setPendingCustomImage(null);
      return;
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!(ALLOWED_OVERLAY_EXTS as readonly string[]).includes(ext)) {
      toast.push("Please choose a PNG, GIF, or JPEG image.", "error");
      return;
    }
    if (file.size > MAX_OVERLAY_IMAGE_BYTES) {
      toast.push("That image is over 2MB — choose a smaller one.", "error");
      return;
    }
    fileToBase64(file)
      .then((base64) => {
        setPendingCustomImage({
          base64,
          ext: ext === "jpeg" ? "jpg" : ext,
          name: file.name,
        });
        toast.push(`${file.name} is ready — press "Start with custom image".`);
      })
      .catch(() => toast.push("Couldn't read that image.", "error"));
  }

  async function loadDetail() {
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDetail(data.agent ?? null);
    } catch {
      toast.push("Couldn't load system info.", "error");
    }
  }

  // Terminal section — standalone, always-visible command runner (Task 18). Was
  // previously the `terminalPanel` const embedded only inside Backstage (gated
  // behind Control -> "Connect to Backend"); now promoted to its own top-level
  // card so it works without that extra step. When the device is online it runs
  // immediately via the live cmd route (unchanged behavior); when offline it
  // offers "Queue for when it's online" instead, backed by QueuedAgentCommand.
  const terminalSection = (
    <Card className="max-w-3xl p-4">
      <h3 className="text-sm font-semibold text-fg">Terminal</h3>
      <p className="mt-0.5 text-xs text-fg-muted">
        Run a command on this device. {deviceOnline ? "Just run it below." : "This device is currently offline — you can queue a command to run automatically the moment it comes back online."}
      </p>

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-fg">Run command</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Shell</label>
            <Select value={shell} onChange={(e) => setShell(e.target.value as "cmd" | "powershell")}>
              <option value="cmd">cmd</option>
              <option value="powershell">powershell</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Timeout (seconds, max 90)</label>
            <Input type="number" min={1} max={90} value={timeout} onChange={(e) => setTimeoutVal(Number(e.target.value))} />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-fg-muted">Command</label>
          <Input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Get-Process" />
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-fg-muted">
          <input type="checkbox" checked={runAsUser} onChange={(e) => setRunAsUser(e.target.checked)} />
          Run as the logged-in user
        </label>
        <div className="mt-3 flex gap-2">
          {deviceOnline ? (
            <Button onClick={runCommand} disabled={cmdLoading || !cmd.trim()} type="button">
              {cmdLoading && <Spinner />} Run
            </Button>
          ) : (
            <Button onClick={queueCommand} disabled={queueLoading || !cmd.trim()} type="button">
              {queueLoading && <Spinner />} Queue for when it&apos;s online
            </Button>
          )}
        </div>
        {cmdOutput !== "" && (
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-300">{cmdOutput}</pre>
        )}
      </div>

      {queuedCommands.length > 0 && (
        <div className="mt-5 border-t border-dashed border-border pt-4">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-fg-muted/80">
            Queued commands
          </p>
          <div className="mt-2 space-y-2">
            {queuedCommands.map((qc) => (
              <div
                key={qc.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-fg">{qc.cmd}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {qc.shell} &middot; {qc.timeoutSeconds}s
                    {qc.runAsUser ? " · as logged-in user" : ""}
                    {qc.status === "queued" && ` · queued ${formatRelativeTime(qc.createdAt)}`}
                    {qc.status === "sent" && qc.sentAt && ` · sent ${formatRelativeTime(qc.sentAt)}`}
                    {qc.status === "failed" && " · failed"}
                    {qc.status === "cancelled" && " · cancelled"}
                  </p>
                  {qc.error && <p className="mt-0.5 text-xs text-red-700">{qc.error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      qc.status === "queued" && "bg-amber-500/15 text-amber-600 dark:text-amber-300",
                      qc.status === "sent" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                      qc.status === "failed" && "bg-red-500/15 text-red-600 dark:text-red-300",
                      qc.status === "cancelled" && "bg-black/10 text-fg-muted dark:bg-white/10",
                    )}
                  >
                    {qc.status}
                  </span>
                  {qc.status === "queued" && (
                    <button
                      type="button"
                      onClick={() => cancelQueued(qc.id)}
                      disabled={cancellingId === qc.id}
                      className="rounded px-2 py-1 text-xs font-medium text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      {cancellingId === qc.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );

  // Post-connect "Tools" menu actions — a data-driven action list so future
  // post-connect tools are added by appending an entry here, not by wiring up a
  // new hardcoded button.
  const postConnectActions: PostConnectAction[] = [];
  // Suspend/Resume input lives in the Tools menu (not a standalone toolbar
  // button) and only makes sense for sessions where the technician controls the
  // device — never the Backstage panel, which has no input-suspend concept.
  if (connectMode !== "backend") {
    postConnectActions.push({
      id: "toggle-input-suspend",
      label: connectMode === "viewonly" ? "Resume input" : "Suspend input",
      description:
        connectMode === "viewonly"
          ? "Hand your input back so you can operate the device directly."
          : "Take your (the technician's) own input off the device so the guest isn't disturbed while you watch.",
      onSelect: () => setConnectMode(connectMode === "viewonly" ? "control" : "viewonly"),
    });
  }
  postConnectActions.push({
    id: "maintenance-overlay",
    label: overlayOn ? "Stop maintenance screen" : "Start maintenance screen",
    description: overlayOn
      ? "Remove the full-screen overlay from the guest's machine and surface their desktop again."
      : "Show a full-screen overlay on the guest's machine (visual cover) while you work remotely — default Windows-Update style, or a custom image you upload. The agent must have an interactive user session for it to appear.",
    disabled: overlayLoading,
    onSelect: () => (overlayOn ? setOverlayToStop(true) : setShowOverlayChooser(true)),
  });
return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-fg">Remote Tools</h2>
      </div>

      <Card className="max-w-3xl p-4">
        <h3 className="text-sm font-semibold text-fg">Remote access</h3>
        {meshLoading ? (
          <p className="mt-2 text-sm text-fg-muted">Loading…</p>
        ) : meshError || !mesh ? (
          <p className="mt-2 text-sm text-fg-muted">{meshError ?? "Remote access is unavailable for this agent."}</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-1">
              {(["file", "control"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                    activeTab === tab
                      ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
                      : "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
                  )}
                >
                  {tab === "control" ? "Control" : "Files"}
                </button>
              ))}
            </div>

            {activeTab === "control" ? (
              connectMode === "choose" ? (
                <ConnectChooser
                  controlAvailable={!!controlUrl}
                  onFullControl={() => setConnectMode("control")}
                  onViewOnly={() => setConnectMode("viewonly")}
                  onBackend={() => setConnectMode("backend")}
                />
              ) : (
                <>
                  {/* Session toolbar — appears once a Control option has been chosen. */}
                  <div className="mt-4 border-t border-dashed border-border pt-4">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-fg-muted/80">
                      Once connected
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {/* Passive mode indicator — the toggle action now lives in the
                          Tools menu; the dot + label pill is read-only status (emerald
                          = input suspended, indigo = full control), not a button. */}
                      {connectMode !== "backend" && (
                        <span
                          aria-hidden
                          title={connectMode === "viewonly" ? "Input suspended" : "Full control"}
                          className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-semibold text-fg"
                        >
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              connectMode === "viewonly" ? "bg-emerald-500" : "bg-indigo-500"
                            }`}
                          />
                          {connectMode === "viewonly" ? "Input suspended" : "Full control"}
                        </span>
                      )}
                      {connectMode !== "backend" && !poppedOut && (
                        <Button variant="secondary" type="button" onClick={openControlInNewTab}>
                          Open in new tab
                        </Button>
                      )}

                      {/* Post-connect tools menu — data-driven, extensible. */}
                      <PostConnectMenu actions={postConnectActions} />

                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => {
                          setConnectMode("choose");
                          setPoppedOut(false);
                        }}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>

                  {connectMode === "backend" ? (
                    <div className="mt-3">
                      <Backstage agentId={agentId} />
                    </div>
                  ) : poppedOut ? (
                    <div className="mt-3 flex h-[480px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-bg text-center">
                      <p className="text-sm text-fg-muted">
                        This session is open in its own tab — the embedded view is
                        paused so only one connection controls the device at a time.
                      </p>
                      <Button variant="secondary" type="button" onClick={() => setPoppedOut(false)}>
                        Reconnect here instead
                      </Button>
                    </div>
                  ) : (
                    <div className="relative mt-3 h-[480px] w-full overflow-hidden rounded-lg border border-border bg-bg">
                      <iframe
                        key={iframeKey}
                        src={
                          connectMode === "viewonly" && realViewOnlyBlock
                            ? viewOnlyUrl ?? undefined
                            : controlSrc ?? undefined
                        }
                        className="h-full w-full"
                        title="MeshCentral Control"
                      />
                      {softGuard && (
                        // Deliberately transparent — this div still blocks accidental
                        // mouse/key input from reaching the iframe underneath (no bg,
                        // no blur), but the technician needs to actually SEE the live
                        // desktop while input is suspended, not have it hidden behind
                        // an opaque "click to unlock" card.
                        <div className="absolute inset-0 z-10">
                          <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg border border-border bg-bg/90 px-3 py-2 shadow-lg backdrop-blur-sm">
                            <span className="text-xs font-medium text-fg-muted">
                              Input suspended — you can see the screen, but clicks/keys aren&apos;t sent.
                            </span>
                            <button
                              type="button"
                              onClick={() => setConnectMode("control")}
                              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                            >
                              Grant input back
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )
            ) : (
              <div className="relative mt-3 h-[480px] w-full overflow-hidden rounded-lg border border-border bg-bg">
                {fileSrc ? (
                  <iframe
                    key={iframeKey}
                    src={fileSrc}
                    className="h-full w-full"
                    title="MeshCentral Files"
                  />
                ) : (
                  <p className="p-4 text-sm text-fg-muted">
                    Files remote access is unavailable for this agent.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {terminalSection}

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-fg">Toolbox</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" type="button" onClick={loadDetail}>Load system info</Button>
        </div>
        {detail && (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <thead><tr><Th>Property</Th><Th>Value</Th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(detail).map(([k, v]) => typeof v !== "object" && (
                  <tr key={k}><Td className="text-fg-muted">{k}</Td><Td>{String(v)}</Td></tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Modal
        open={showOverlayChooser}
        onClose={() => setShowOverlayChooser(false)}
        title="Start maintenance screen"
      >
        <p className="text-sm text-fg-muted">
          Choose what the guest sees on their screen while you work remotely. This
          shows full-screen on the end user&apos;s monitor (Windows only) either as the
          default fake-Windows-Update look or as a custom image you upload. The
          agent must have an interactive user session for it to appear.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            disabled={overlayLoading}
            onClick={() => setOverlay(true)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-bg p-4 text-left transition-colors hover:border-brand-500 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
          >
            <span>
              <span className="block text-sm font-semibold text-fg">Default (Windows Update style)</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Dark screen with a &quot;Working on updates&quot; spinner.
              </span>
            </span>
            <span aria-hidden className="text-fg-muted">→</span>
          </button>

          <div className="rounded-lg border border-border bg-bg p-4">
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-fg">Custom image / animation</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  Show a PNG, GIF, or JPEG you upload. It isn&apos;t stored by us — it&apos;s
                  used for this session only. GIFs currently render as a static image.
                  {pendingCustomImage && (
                    <span className="mt-1 block text-xs font-medium text-fg">
                      {pendingCustomImage.name} selected.
                    </span>
                  )}
                </span>
              </span>
              <label className="cursor-pointer whitespace-nowrap rounded-lg border border-border px-3 py-2 text-xs font-medium text-fg hover:bg-black/5 dark:hover:bg-white/5">
                Choose file
                <input
                  type="file"
                  accept="image/png,image/gif,image/jpeg"
                  className="sr-only"
                  onChange={(e) => handleCustomFileChange(e.target.files?.[0] ?? undefined)}
                />
              </label>
            </div>
            <Button
              variant="primary"
              type="button"
              className="mt-4"
              disabled={!pendingCustomImage || overlayLoading}
              onClick={() => {
                if (!pendingCustomImage) return;
                setOverlay(true, {
                  customImageBase64: pendingCustomImage.base64,
                  customImageExt: pendingCustomImage.ext,
                });
                setPendingCustomImage(null);
              }}
            >
              Start with custom image
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={overlayToStop}
        onClose={() => setOverlayToStop(false)}
        onConfirm={() => setOverlay(false)}
        title="Stop maintenance overlay?"
        description="This removes the full-screen overlay from the end user's machine and surfaces their desktop again."
        confirmLabel="Stop overlay"
        confirmVariant="primary"
        confirming={overlayLoading}
      />
    </div>
  );
}