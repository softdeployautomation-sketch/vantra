"use client";

import { Fragment, useEffect, useState } from "react";

import { Button, Input, Td, Th } from "@/components/ui";

type ApiErrorLogEntry = {
  id: string;
  route: string;
  method: string;
  statusCode: number;
  errorMessage: string;
  stack: string | null;
  userId: string | null;
  createdAt: string;
};

export function AdminErrorsClient() {
  const [logs, setLogs] = useState<ApiErrorLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Applied (server-side) filter values.
  const [route, setRoute] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Draft inputs — only applied on Search so typing doesn't refetch on every keystroke.
  const [draftRoute, setDraftRoute] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");

  // Which row's full details (stack trace, userId) are expanded.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (route) params.set("route", route);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/admin/errors?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setLogs(Array.isArray(data.logs) ? data.logs : []);
          setTotal(typeof data.total === "number" ? data.total : 0);
          setPage(typeof data.page === "number" ? data.page : 1);
        } else {
          setError(typeof data.error === "string" ? data.error : "Failed to load errors");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [page, route, from, to]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applyFilters() {
    setRoute(draftRoute.trim());
    setFrom(draftFrom);
    setTo(draftTo);
    setPage(1);
    setExpandedId(null);
  }

  function clearFilters() {
    setDraftRoute("");
    setDraftFrom("");
    setDraftTo("");
    setRoute("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div>
      <div className="mt-6 rounded-xl border border-border bg-bg-elevated p-4">
        <div className="text-sm font-medium text-fg">Filters</div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium text-fg-muted">Route</label>
            <Input
              placeholder="e.g. mesh"
              value={draftRoute}
              onChange={(e) => setDraftRoute(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">From</label>
            <Input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">To</label>
            <Input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={applyFilters}>Search</Button>
            <Button variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-fg-muted">
        {total} error{total === 1 ? "" : "s"} — most recent first.
      </p>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="mt-6 text-sm text-fg-muted">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-fg-muted">
            {route || from || to ? "No errors match those filters" : "No API errors logged"}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-bg-elevated">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead>
              <tr>
                <Th>Route</Th>
                <Th>Method</Th>
                <Th>Status</Th>
                <Th>Error</Th>
                <Th>Timestamp</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <Td className="font-mono text-xs">
                      <span className="text-fg">{l.route}</span>
                    </Td>
                    <Td className="uppercase">{l.method}</Td>
                    <Td>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          l.statusCode >= 500
                            ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        }`}
                      >
                        {l.statusCode}
                      </span>
                    </Td>
                    <Td className="max-w-[320px]">
                      <span className="block truncate text-fg-muted" title={l.errorMessage}>
                        {l.errorMessage}
                      </span>
                    </Td>
                    <Td className="text-fg-muted">{new Date(l.createdAt).toLocaleString()}</Td>
                    <Td>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                      >
                        {expandedId === l.id ? "Hide" : "Details"}
                      </Button>
                    </Td>
                  </tr>
                  {expandedId === l.id && (
                    <tr>
                      <Td colSpan={6} className="bg-black/[0.025] dark:bg-white/[0.03]">
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
                          <span>
                            <span className="font-semibold">Route:</span>{" "}
                            <span className="font-mono">{l.route}</span>
                          </span>
                          <span>
                            <span className="font-semibold">Method:</span>{" "}
                            <span className="font-mono">{l.method}</span>
                          </span>
                          <span>
                            <span className="font-semibold">Status:</span> {l.statusCode}
                          </span>
                          <span>
                            <span className="font-semibold">User:</span>{" "}
                            <span className="font-mono">{l.userId ?? "—"}</span>
                          </span>
                        </div>
                        <div className="mt-2 rounded-lg border border-border bg-bg-elevated p-3">
                          <div className="text-xs font-semibold text-fg">Error message</div>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-fg">
                            {l.errorMessage}
                          </pre>
                          <div className="mt-3 text-xs font-semibold text-fg">Stack trace</div>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-fg-muted">
                            {l.stack ?? "— no stack captured"}
                          </pre>
                        </div>
                      </Td>
                    </tr>
                  )}
                </Fragment>
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