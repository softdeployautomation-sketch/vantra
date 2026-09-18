"use client";

import { useCallback, useEffect, useState } from "react";

import { DeviceCard, type DeviceView } from "@/components/device-card";
import { Button, Spinner } from "@/components/ui";

// Task 44.4 — the desktop EXE's thin local devices LIST (the local-first surface the
// Tauri window lands on after the license gate). Fetches the local mirror via
// /api/local/devices (NOT the hosted dashboard — GDPR-in-green: works fully offline),
// and reuses DeviceCard for rendering + inline rename, pointed at the local slice.
// This is deliberately SLIM: full groups/context-menu/remote-exec/add-device live in
// the hosted dashboard-client; this surface only exercises the local DB connection.
// It matches the task's explicit guidance — a thin purpose-built page, the /console
// precedent — rather than dragging the whole hosted Shell layout in.

export function LocalDevices() {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/local/devices");
      if (!res.ok) {
        setError("Could not load devices from the local database.");
        return;
      }
      const data = (await res.json()) as { devices?: DeviceView[] };
      setDevices(data.devices ?? []);
    } catch {
      setError("Network error loading devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Offline re-sync is wired to the (increment-2) sync engine; today this is a
  // no-op placeholder so the button reads accurately (devices are already local).
  async function syncNow() {
    setSyncing(true);
    try {
      await fetch("/api/local/sync", { method: "POST" }).catch(() => null);
    } finally {
      setSyncing(false);
      void load();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg-elevated px-5">
        <div>
          <h1 className="text-base font-semibold text-fg">My devices</h1>
          <p className="text-xs text-fg-muted">Stored locally on this computer</p>
        </div>
        <Button variant="ghost" type="button" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-fg-muted">
            <Spinner className="h-5 w-5" /> Loading devices…
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md px-4 py-16 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button className="mt-4" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : devices.length === 0 ? (
          <div className="mx-auto max-w-md px-4 py-16 text-center">
            <p className="text-sm text-fg-muted">
              No devices yet. Connect an agent and it will appear here.
            </p>
          </div>
        ) : (
          <div>
            {devices.map((device) => (
              <DeviceCard
                key={device.agent_id}
                device={device}
                checked={false}
                onToggle={() => {}}
                canRename
                // Point the inline rename at the local slice (writes the local DB + outbox).
                labelEndpoint={`/api/local/devices/${encodeURIComponent(device.agent_id)}`}
                detailHref={`/local/devices/${encodeURIComponent(device.agent_id)}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}