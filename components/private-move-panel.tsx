"use client";
import { useEffect, useState } from "react";
import { Button, Select, Spinner } from "@/components/ui";

interface Candidate {
  agentId: string;
  hostname: string;
  status: string;
  sourceOrgId: string;
  sourceOrgName: string;
}

export function PrivateMovePanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [destName, setDestName] = useState("");
  const [devices, setDevices] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/devices/move-candidates")
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!active) return;
        if (!ok) {
          setLoadError(typeof d.error === "string" ? d.error : "Could not load devices.");
          return;
        }
        setDestName(typeof d.destination?.name === "string" ? d.destination.name : "");
        const list = Array.isArray(d.devices) ? d.devices : [];
        setDevices(list);
        if (list.length === 1 && list[0]?.agentId) setSelected(list[0].agentId);
      })
      .catch(() => {
        if (active) setLoadError("Network error while loading devices.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function generate() {
    if (!selected) return;
    setGenerating(true);
    setGenError(null);
    setScript(null);
    setCopied(false);
    try {
      const res = await fetch("/api/devices/move-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.script) {
        setGenError(typeof data.error === "string" ? data.error : "Could not generate.");
        return;
      }
      setScript(data.script);
    } catch {
      setGenError("Network error while generating the command.");
    } finally {
      setGenerating(false);
    }
  }

  async function copyCommand() {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  const chosen = devices.find((d) => d.agentId === selected) ?? null;

  return (
    <div className="mt-6 rounded-xl border border-border bg-bg-elevated p-5">
      <h1 className="text-lg font-bold text-fg">Add device by manual move</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Private organizations add devices by moving them from one of your public
        organizations. Pick a device, generate its move command, then run it in
        an elevated PowerShell on the device. Manual version of the one-click
        move button on the device page.
      </p>
      {destName && (
        <p className="mt-2 text-sm text-fg">
          Destination: <span className="font-semibold">{destName}</span>
        </p>
      )}
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner className="h-4 w-4" /> Loading your public-org devices
        </div>
      ) : loadError ? (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>
      ) : devices.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-fg">No devices in your public organizations yet.</p>
          <p className="mt-1 text-xs text-fg-muted">Generate an installer there first.</p>
        </div>
      ) : (
        <div className="mt-4">
          <label htmlFor="private-move-device" className="mb-1 block text-sm font-medium text-fg">
            Device to move
          </label>
          <Select
            id="private-move-device"
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setScript(null); setGenError(null); }}
            disabled={generating}
          >
            <option value="" disabled>Choose a device</option>
            {devices.map((d) => (
              <option key={d.agentId} value={d.agentId}>
                {d.hostname} ({d.sourceOrgName})
              </option>
            ))}
          </Select>
          {chosen && (
            <p className="mt-1 text-xs text-fg-muted">
              From {chosen.sourceOrgName} - {chosen.status}
            </p>
          )}
          <div className="mt-3">
            <Button type="button" onClick={() => void generate()} disabled={!selected || generating}>
              {generating && <Spinner />} Generate move command
            </Button>
          </div>
          {genError && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{genError}</div>
          )}
          {script && (
            <div className="mt-3">
              <p className="text-xs font-medium text-fg">Run in elevated PowerShell on the device:</p>
              <div className="relative mt-2">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-3 pr-16 text-xs text-green-300">
                  {script}
                </pre>
                <Button
                  variant="secondary"
                  className="absolute right-2 top-2 px-2 py-1 text-xs"
                  type="button"
                  onClick={() => void copyCommand()}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                The device was already filed under this private org. Once the
                command runs, the agent switches domain and checks in here.
              </p>
            </div>
          )}
        </div>
      )}
      <p className="mt-4 text-sm text-fg-muted">
        Device online now? The one-click move button on its device page does this automatically.
      </p>
    </div>
  );
}