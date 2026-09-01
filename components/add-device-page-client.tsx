"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AddDeviceModal, type InstallerResult } from "@/components/add-device-modal";

export function AddDevicePageClient() {
  const [activeCount, setActiveCount] = useState(0);
  const [maxDevices, setMaxDevices] = useState(3);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d) => {
        setActiveCount(d.activeDeployments ?? 0);
        setMaxDevices(d.maxDevices ?? 3);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  function onCreated(result: InstallerResult) {
    setActiveCount(result.activeCount);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/dashboard" className="text-sm text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>
      <div className="mt-6">
        <AddDeviceModal
          activeCount={activeCount}
          maxDevices={maxDevices}
          onCreated={onCreated}
        />
      </div>
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Good to know:</strong> each installer link expires after 72 hours,
        and the free tier allows {maxDevices} active installation files. Some
        antivirus software may flag the generated installer — this is being
        addressed separately. If you run into issues, contact support.
      </div>
      <p className="mt-4 text-xs text-gray-500">
        {ready ? "Ready." : "Loading account info…"}
      </p>
    </div>
  );
}