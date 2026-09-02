"use client";

import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Card, Input, Select, Spinner, Td, Th, Table } from "@/components/ui";

export function RemoteTools({ agentId }: { agentId: string }) {
  const toast = useToast();
  const [mesh, setMesh] = useState<Record<string, string> | null>(null);
  const [meshLoading, setMeshLoading] = useState(true);
  const [meshError, setMeshError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"control" | "terminal" | "file">("control");

  const [cmd, setCmd] = useState("");
  const [shell, setShell] = useState<"cmd" | "powershell">("cmd");
  const [timeout, setTimeoutVal] = useState(30);
  const [runAsUser, setRunAsUser] = useState(false);
  const [cmdOutput, setCmdOutput] = useState("");
  const [cmdLoading, setCmdLoading] = useState(false);

  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [showOverlayStart, setShowOverlayStart] = useState(false);
  const [overlayToStop, setOverlayToStop] = useState(false);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`/api/devices/${encodeURIComponent(agentId)}/mesh`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMesh(d.urls ?? null))
      .catch(() => setMeshError("Couldn't load remote-access details."))
      .finally(() => setMeshLoading(false));
  }, [agentId]);

  const meshUrl = mesh ? mesh[activeTab] ?? null : null;

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

  async function setOverlay(on: boolean) {
    setOverlayLoading(true);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/maintenance-overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "start" : "stop" }),
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
      setShowOverlayStart(false);
      setOverlayToStop(false);
    }
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

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-fg">Remote Tools</h2>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-fg">Remote access</h3>
        {meshLoading ? (
          <p className="mt-2 text-sm text-fg-muted">Loading…</p>
        ) : meshError || !meshUrl ? (
          <p className="mt-2 text-sm text-fg-muted">{meshError ?? "Remote access is unavailable for this agent."}</p>
        ) : (
          <>
            <div className="mt-3 flex gap-2">
              {(["control", "terminal", "file"] as const).map((tab) => (
                <Button key={tab} type="button" variant={activeTab === tab ? "primary" : "secondary"} onClick={() => setActiveTab(tab)}>
                  {tab === "control" ? "Control" : tab === "terminal" ? "Terminal" : "Files"}
                </Button>
              ))}
            </div>
            <div className="mt-3 h-[480px] w-full overflow-hidden rounded-lg border border-border bg-bg">
              <iframe src={meshUrl} className="h-full w-full" title={`MeshCentral ${activeTab}`} />
            </div>
          </>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-fg">Run command</h3>
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
          <Button onClick={runCommand} disabled={cmdLoading} type="button">{cmdLoading && <Spinner />} Run</Button>
        </div>
        {cmdOutput !== "" && (
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-300">{cmdOutput}</pre>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-fg">Toolbox</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" type="button" onClick={loadDetail}>Load system info</Button>
          <Button type="button" variant={overlayOn ? "secondary" : "primary"} disabled={overlayLoading} onClick={() => (overlayOn ? setOverlayToStop(true) : setShowOverlayStart(true))}>
            {overlayLoading && <Spinner />}
            {overlayOn ? "Stop maintenance overlay" : "Start maintenance overlay"}
          </Button>
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

      <ConfirmDialog
        open={showOverlayStart}
        onClose={() => setShowOverlayStart(false)}
        onConfirm={() => setOverlay(true)}
        title="Start maintenance overlay?"
        description="This shows a 'Windows Update' style full-screen overlay on the end user's machine (Windows only). It mimics an update but blocks nothing — it's visual cover while you work remotely. The agent must have an interactive user session for it to appear."
        confirmLabel="Start overlay"
        confirmVariant="primary"
        confirming={overlayLoading}
      />
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