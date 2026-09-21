"use client";

import { useEffect, useState } from "react";

import { Button, Card, Spinner } from "@/components/ui";

// Task 64 (Task 53 Part 4, "auto mode"): the org-settings toggle for the
// silent 20-minute move. Only rendered when the ACTIVE org is public-tier
// AND the owner actually has a private org to move into (mirrors Task 63's
// button visibility — the "can't move into nothing" rule); hidden otherwise.
export function AutoMoveToggle() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [destinationName, setDestinationName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/organizations/auto-move")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const show = d.tier === "public" && d.hasPrivateDestination === true;
        setVisible(show);
        setEnabled(d.enabled === true);
        setDestinationName(typeof d.destinationName === "string" ? d.destinationName : null);
        if (d.error) setError(d.error);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading || !visible) return null;

  async function flip(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/organizations/auto-move", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Couldn't update the automatic move setting.");
        return;
      }
      setEnabled(data.enabled === true);
    } catch {
      setError("Network error while updating the automatic move setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-fg">Automatic move to private</h2>
      <p className="mt-1 text-xs text-fg-muted">
        When on, devices added to this organization move themselves to{" "}
        {destinationName ? <span className="font-medium text-fg">{destinationName}</span> : "your private organization"}{" "}
        20 minutes after joining — silently, with nothing to click and nothing shown on the device.
      </p>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="text-sm text-fg">{enabled ? "On" : "Off"}</span>
        <Button
          variant="secondary"
          type="button"
          onClick={() => void flip(!enabled)}
          disabled={saving}
        >
          {saving && <Spinner />} {enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
    </Card>
  );
}
