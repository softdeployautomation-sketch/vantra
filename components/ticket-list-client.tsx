"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Badge, Button, Input, Label, Spinner, Td, Textarea, Th, Table } from "@/components/ui";
import { ticketStatusMeta } from "@/lib/ticket-status";

interface TicketView {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  user?: { orgName: string | null; email: string } | null;
}

export function TicketListClient({ isStaff }: { isStaff: boolean }) {
  const toast = useToast();
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/tickets")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setTickets(d.tickets ?? []);
      })
      .catch(() => setError("Couldn't load tickets."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createTicket() {
    setCreateError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(data.error ?? "Couldn't open the ticket.");
        return;
      }
      setCreateOpen(false);
      setSubject("");
      setBody("");
      toast.push(`Ticket opened: "${data.ticket?.subject ?? subject}"`, "success");
      load();
    } catch {
      setCreateError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={() => setCreateOpen(true)} type="button" className="ml-auto block">
        New ticket
      </Button>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && tickets.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-fg-muted">
          <Spinner className="mr-2" /> Loading tickets…
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-bg-elevated py-16 text-center">
          <p className="text-fg">No tickets yet.</p>
          <p className="mt-1 text-sm text-fg-muted">Open one and we&apos;ll take it from there.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <thead>
              <tr className="bg-bg-elevated">
                <Th>Subject</Th>
                <Th>Status</Th>
                {isStaff && <Th>Customer</Th>}
                <Th>Last updated</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-bg-elevated">
              {tickets.map((t) => {
                const meta = ticketStatusMeta(t.status);
                return (
                  <tr key={t.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.04]">
                    <Td>
                      <Link
                        href={`/dashboard/support/${t.id}`}
                        className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t.subject}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </Td>
                    {isStaff && (
                      <Td className="text-fg-muted">{t.user?.orgName || t.user?.email || "—"}</Td>
                    )}
                    <Td className="text-fg-muted">{new Date(t.updatedAt).toLocaleString()}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {/* New ticket modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Open a support ticket">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createTicket();
          }}
          className="space-y-4"
        >
          {createError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</div>
          )}
          <div>
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="e.g. Device went offline unexpectedly"
              required
            />
          </div>
          <div>
            <Label htmlFor="ticket-body">How can we help?</Label>
            <Textarea
              id="ticket-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Describe the issue and any steps you've already tried…"
              required
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !subject.trim() || !body.trim()}>
              {saving && <Spinner />} Open ticket
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}