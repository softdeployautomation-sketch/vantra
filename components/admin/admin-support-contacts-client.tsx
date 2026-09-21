"use client";

import { useState } from "react";

import { Badge, Button, Td, Th } from "@/components/ui";

// Task 69, scope 5 — admin triage inbox for the locked-out contact surface.
// Simple list reusing the existing admin table patterns; resolve/reopen via
// PATCH /api/admin/support-contacts/[id]. Staff reply by emailing the
// address given (triage inbox, not the Ticket thread).
export function AdminSupportContactsClient({
  initial,
}: {
  initial: Array<{
    id: string;
    email: string;
    message: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function setResolved(id: string, resolved: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/support-contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const updated = data.contact as { id: string; resolvedAt: string | null };
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, resolvedAt: updated.resolvedAt } : r)));
    } finally {
      setBusy(null);
    }
  }

  const open = rows.filter((r) => !r.resolvedAt).length;
  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Support contacts</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Locked-out messages sent without signing in ({rows.length}) · {open} open. Reply by emailing the
        address given — this is a triage inbox, not the ticket thread.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
        <table className="min-w-full divide-y divide-border text-left text-sm">
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Message</Th>
              <Th>Status</Th>
              <Th>Received</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                <Td><div className="font-medium text-fg">{r.email}</div></Td>
                <Td><div className="max-w-md whitespace-pre-wrap text-fg-muted">{r.message}</div></Td>
                <Td>{r.resolvedAt ? <Badge tone="success">Resolved</Badge> : <Badge tone="warning">Open</Badge>}</Td>
                <Td className="text-fg-muted">{new Date(r.createdAt).toLocaleString()}</Td>
                <Td className="text-right">
                  <Button variant="secondary" disabled={busy === r.id} onClick={() => void setResolved(r.id, !r.resolvedAt)}>
                    {r.resolvedAt ? "Reopen" : "Resolve"}
                  </Button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><Td colSpan={5} className="text-center text-fg-muted">No messages yet.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
