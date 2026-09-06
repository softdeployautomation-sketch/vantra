"use client";

import { useEffect, useState } from "react";

import { Badge, Button, Td, Th } from "@/components/ui";

type NotificationLogEntry = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  eventType: string;
  channel: string;
  recipient: string;
  outcome: string;
  errorMessage: string | null;
  createdAt: string;
};

const NOTIFICATION_FILTERS = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
] as const;

export function AdminNotificationsClient() {
  const [logs, setLogs] = useState<NotificationLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filter, setFilter] = useState<(typeof NOTIFICATION_FILTERS)[number]["id"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (filter !== "all") params.set("outcome", filter);
        const res = await fetch(`/api/admin/notifications?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setLogs(Array.isArray(data.logs) ? data.logs : []);
          setTotal(typeof data.total === "number" ? data.total : 0);
          setPage(typeof data.page === "number" ? data.page : 1);
        } else {
          setError(typeof data.error === "string" ? data.error : "Failed to load notifications");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [page, filter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Notifications</h2>
        <div className="flex gap-1">
          {NOTIFICATION_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setPage(1);
                setFilter(f.id);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f.id
                  ? "bg-brand-600 text-white"
                  : "text-fg-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {total} notification{total === 1 ? "" : "s"} — every attempted send, most recent first.
      </p>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="mt-6 text-sm text-fg-muted">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-fg-muted">No notifications logged</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead>
              <tr>
                <Th>Event type</Th>
                <Th>Recipient</Th>
                <Th>Channel</Th>
                <Th>Outcome</Th>
                <Th>Timestamp</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => (
                <tr key={l.id}>
                  <Td className="font-mono text-xs">{l.eventType}</Td>
                  <Td>
                    {l.userEmail ? (
                      <span className="text-fg-muted">{l.userEmail}</span>
                    ) : null}
                    <span className="block text-xs text-fg-muted">{l.recipient}</span>
                  </Td>
                  <Td className="uppercase">{l.channel}</Td>
                  <Td>
                    <Badge tone={l.outcome === "sent" ? "success" : "danger"}>{l.outcome}</Badge>
                  </Td>
                  <Td className="text-fg-muted">{new Date(l.createdAt).toLocaleString()}</Td>
                  <Td className="max-w-[260px] text-xs text-fg-muted">
                    {l.outcome === "failed" ? (l.errorMessage ?? "Unknown error") : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-fg-muted">
          Page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}