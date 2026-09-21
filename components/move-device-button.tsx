"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Select, Spinner } from "@/components/ui";

// Task 63 (Task 53 Part 4): one-click "Move to private organization" button.
// Self-hiding: fetches GET /api/devices/[agentId]/move on mount; renders
// nothing when the caller has no private-org destination (public-only user)
// or while loading. The POST endpoint enforces auth — this is display only.
export function MoveDeviceButton({
  agentId,
  sourceOrgId,
}: {
  agentId: string;
  // Admin use only: the org the device currently belongs to (admin sessions
  // must name the source explicitly — no active-org context). Customer
  // sessions must NOT pass this (server resolves from their own orgs; the
  // endpoint 400s if they send it).
  sourceOrgId?: string;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [canMove, setCanMove] = useState(false);
  const [destinations, setDestinations] = useState<Array<{ id: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [destId, setDestId] = useState("");
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; step?: string; error?: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/devices/${encodeURIComponent(agentId)}/move`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setCanMove(d.canMove === true);
        const list = Array.isArray(d.destinations) ? d.destinations : [];
        setDestinations(list);
        if (list.length === 1) setDestId(list[0].id);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agentId]);

  if (loading || !canMove) return null;

  function openModal() {
    setResult(null);
    setOpen(true);
  }

  async function move() {
    setMoving(true);
    setResult(null);
    try {
      const body: Record<string, string> = {};
      const chosen = destId || destinations[0]?.id || "";
      if (chosen) body.destinationOrgId = chosen;
      if (sourceOrgId) body.sourceOrgId = sourceOrgId;
      const res = await fetch(`/api/devices/${encodeURIComponent(agentId)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setResult({ ok: true, step: "done" });
        toast.push("Device moved to the private organization.", "success");
      } else if (data.step === "reconfigure") {
        setResult({ ok: false, step: "reconfigure", error: data.error });
      } else if (data.step === "reassign") {
        setResult({ ok: false, step: "reassign", error: data.error });
      } else {
        setResult({ ok: false, error: data.error ?? "Couldn't move the device." });
      }
    } catch {
      setResult({ ok: false, error: "Network error while moving the device." });
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      <Button variant="secondary" type="button" onClick={openModal}>
        Move to private organization
      </Button>
      <Modal open={open} onClose={() => !moving && setOpen(false)} title="Move to private organization?">
        <p className="text-sm text-fg-muted">
          This files the device under the private organization and switches its
          agent to the private domain. One-way only — a device cannot be moved
          back via this button.
        </p>
        {destinations.length > 1 && (
          <div className="mt-4">
            <label htmlFor="move-dest" className="mb-1 block text-sm font-medium text-fg">
              Destination
            </label>
            <Select id="move-dest" value={destId} onChange={(e) => setDestId(e.target.value)} disabled={moving}>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {destinations.length === 1 && (
          <p className="mt-3 text-sm text-fg">
            Destination: <span className="font-semibold">{destinations[0].name}</span>
          </p>
        )}
        {result && !result.ok && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {result.step === "reconfigure" ? (
              <>
                <strong>Partially moved.</strong> {result.error}{" "}
                The device is already filed under the private organization — retrying only re-runs the agent switch.
              </>
            ) : (
              <>{result.error}</>
            )}
          </div>
        )}
        {result && result.ok && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Moved. The device now belongs to the private organization — switch to it in the org switcher to see it.
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => !moving && setOpen(false)} disabled={moving}>
            {result?.ok ? "Close" : "Cancel"}
          </Button>
          {!result?.ok && (
            <Button
              variant="primary"
              type="button"
              onClick={() => void move()}
              disabled={moving || (!destId && destinations.length !== 1 && destinations.length !== 0)}
            >
              {moving && <Spinner />} Move device
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
