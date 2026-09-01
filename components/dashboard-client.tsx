"use client";

import { useEffect, useState } from "react";

import { AddDeviceModal, type InstallerResult } from "@/components/add-device-modal";
import { DeviceCard, type DeviceView } from "@/components/device-card";
import { Button, Spinner } from "@/components/ui";

export function DashboardClient() {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [maxDevices, setMaxDevices] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // NOTE: no setState is called synchronously here — only via async continuations,
  // so calling this from an effect is lint-clean.
  async function load() {
    try {
      const res = await fetch("/api/devices");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't load devices.");
        return;
      }
      setDevices(data.devices ?? []);
      setActiveCount(data.activeDeployments ?? 0);
      setMaxDevices(data.maxDevices ?? 3);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    // Inline the initial fetch + polling. All setState happen in async
    // continuations (.then/.catch/.finally), which satisfies the lint rule.
    fetch("/api/devices")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDevices(data.devices ?? []);
        setActiveCount(data.activeDeployments ?? 0);
        setMaxDevices(data.maxDevices ?? 3);
      })
      .catch(() => {
        if (active) setError("Couldn't reach the device server.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const id = setInterval(() => {
      load();
    }, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  function onRefresh() {
    setError(null);
    setLoading(true);
    load();
  }

  function onCreated(result: InstallerResult) {
    setActiveCount(result.activeCount);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your devices</h1>
          <p className="mt-1 text-sm text-gray-600">
            Live status from your fleet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            {loading ? <Spinner /> : "Refresh"}
          </Button>
          <AddDeviceModal
            activeCount={activeCount}
            maxDevices={maxDevices}
            onCreated={onCreated}
          />
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {loading && devices.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Spinner className="mr-2" /> Loading devices…
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-gray-700">No devices yet.</p>
            <p className="mt-1 text-sm text-gray-500">
              Use &quot;Add Device&quot; to generate a Windows installer.
            </p>
          </div>
        ) : (
          devices.map((d) => <DeviceCard key={d.agent_id} device={d} />)
        )}
      </div>
    </div>
  );
}