"use client";

import { useState } from "react";

import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface InstallerResult {
  downloadUrl: string;
  expiresAt: string;
  activeCount: number;
  maxDevices: number;
}

// Windows is the only working path today; macOS/Linux are blocked upstream on the
// TRMM code-signing arrangement (same as the Windows AV issue). Present but
// disabled so the roadmap is visible — see plan §"Multi-platform installers".
const OS_OPTIONS: Array<{ key: string; label: string; available: boolean }> = [
  { key: "windows", label: "Windows", available: true },
  { key: "macos", label: "macOS", available: false },
  { key: "linux", label: "Linux", available: false },
];

export function AddDeviceModal({
  activeCount,
  maxDevices,
  onCreated,
}: {
  activeCount: number;
  maxDevices: number;
  onCreated?: (result: InstallerResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallerResult | null>(null);

  const atLimit = activeCount >= maxDevices;

  function close() {
    setOpen(false);
    setError(null);
  }

  async function createInstaller() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/devices/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: "workstation", goarch: "amd64" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't generate an installer.");
        return;
      }
      setResult(data);
      onCreated?.(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Add Device
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-bg-elevated p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {result ? (
              <>
                <h2 className="text-lg font-bold text-fg">Installer ready</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Download and run this on the Windows device you want to monitor.
                  The link expires on{" "}
                  <span className="font-medium text-fg">
                    {new Date(result.expiresAt).toLocaleString()}
                  </span>
                  .
                </p>
                <a href={result.downloadUrl} target="_blank" rel="noreferrer">
                  <Button className="mt-4 w-full">Download for Windows</Button>
                </a>
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Security note: some antivirus programs may flag this generated
                  installer. This is being addressed separately. If it&apos;s blocked,
                  please contact support.
                </p>
                <Button variant="secondary" className="mt-3 w-full" onClick={close} type="button">
                  Done
                </Button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-fg">Add a device</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Choose an operating system to generate a secure installer.
                </p>

                {/* OS picker */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {OS_OPTIONS.map((os) => (
                    <div
                      key={os.key}
                      className={cn(
                        "rounded-lg border px-3 py-3 text-center text-sm font-medium",
                        os.available
                          ? "border-brand-200 bg-brand-50 text-brand-700"
                          : "border-dashed border-border bg-bg text-fg-muted",
                      )}
                    >
                      <div>{os.label}</div>
                      {!os.available && (
                        <div className="mt-1 text-[11px] font-normal text-fg-muted">
                          Coming soon · pending code signing
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <p className="text-xs text-fg-muted">
                    Active installers:{" "}
                    <span className="font-semibold text-fg">
                      {activeCount}
                    </span>{" "}
                    / {maxDevices}
                  </p>
                </div>
                {error && (
                  <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={createInstaller}
                    disabled={loading || atLimit}
                    className="flex-1"
                    type="button"
                  >
                    {loading && <Spinner />}
                    {atLimit ? "Limit reached" : "Generate installer"}
                  </Button>
                  <Button variant="secondary" type="button" onClick={close}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}