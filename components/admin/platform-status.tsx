"use client";

import { useEffect, useState } from "react";

import { Badge, Card, Spinner } from "@/components/ui";

interface PlatformState {
  vantra: boolean;
  spaceworker: boolean;
}

type TileState = "checking" | "up" | "down";

function tileState(value: boolean | undefined): TileState {
  if (value === undefined) return "checking";
  return value ? "up" : "down";
}

const TILE_META: Record<TileState, { tone: "success" | "danger" | "neutral"; label: string }> = {
  up: { tone: "success", label: "Up" },
  down: { tone: "danger", label: "Down" },
  checking: { tone: "neutral", label: "Checking…" },
};

// Compact product-status summary for the admin landing dashboard — deliberately
// NOT a duplicate of the full Services table on /admin101/vps. Polls the admin
// status API on an interval so a tile flips to "down" within one refresh cycle.
const REFRESH_MS = 15_000;

export function PlatformStatusTiles() {
  const [status, setStatus] = useState<PlatformState | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/status");
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok && data.platform) {
          setStatus(data.platform);
        }
      } catch {
        // Leave the tiles in their current state; the next poll retries.
      }
    }
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const vantra = tileState(status?.vantra);
  const spaceworker = tileState(status?.spaceworker);

  return (
    <div className="grid max-w-xl gap-3 sm:grid-cols-2">
      <PlatformTile
        title="Vantra"
        subtitle="Device management platform"
        state={vantra}
        loading={!status}
      />
      <PlatformTile
        title="SpaceWorker"
        subtitle="Lead extraction & outreach"
        state={spaceworker}
        loading={!status}
      />
    </div>
  );
}

function PlatformTile({
  title,
  subtitle,
  state,
  loading,
}: {
  title: string;
  subtitle: string;
  state: TileState;
  loading: boolean;
}) {
  const meta = TILE_META[state];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-fg">{title}</div>
          <div className="mt-0.5 text-xs text-fg-muted">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? <Spinner className="h-3.5 w-3.5 text-fg-muted" /> : null}
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
      </div>
    </Card>
  );
}