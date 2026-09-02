"use client";

import { useState } from "react";

import { useToast } from "@/components/toast";
import { Badge, Button, Select, Spinner, Textarea } from "@/components/ui";

interface ThreadAuthor {
  orgName: string | null;
}

export interface TicketMessageView {
  id: string;
  body: string;
  authorIsStaff: boolean;
  createdAt: string;
  author?: ThreadAuthor | null;
}

export interface TicketView {
  id: string;
  subject: string;
  status: string;
  messages: TicketMessageView[];
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
] as const;

export function TicketThreadClient({
  ticket: initial,
  isStaff,
}: {
  ticket: TicketView;
  isStaff: boolean;
}) {
  const toast = useToast();
  const [ticket, setTicket] = useState<TicketView>(initial);
  const [newStatus, setNewStatus] = useState(initial.status);
  const [changingStatus, setChangingStatus] = useState(false);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingError, setSendingError] = useState<string | null>(null);

  async function changeStatus() {
    if (newStatus === ticket.status) return;
    setChangingStatus(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't update the status.", "error");
        setNewStatus(ticket.status);
        return;
      }
      setTicket((t) => ({ ...t, status: data.ticket?.status ?? t.status }));
      toast.push("Ticket status updated.");
    } catch {
      toast.push("Network error while updating the status.", "error");
      setNewStatus(ticket.status);
    } finally {
      setChangingStatus(false);
    }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setSendingError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendingError(data.error ?? "Couldn't send your reply.");
        return;
      }
      setTicket((t) => ({
        ...t,
        status: data.ticket?.status ?? t.status,
        messages: [...t.messages, data.message],
      }));
      setReply("");
      toast.push("Reply sent.");
    } catch {
      setSendingError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function selfResolve() {
    setChangingStatus(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't resolve the ticket.", "error");
        return;
      }
      setTicket((t) => ({ ...t, status: "resolved" }));
      setNewStatus("resolved");
      toast.push("Ticket marked as resolved.");
    } catch {
      toast.push("Network error while resolving the ticket.", "error");
    } finally {
      setChangingStatus(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">{ticket.subject}</h1>
        </div>
        <Badge tone={ticket.status === "open" ? "warning" : ticket.status === "in_progress" ? "neutral" : "success"}>
          {ticket.status === "open" ? "Open" : ticket.status === "in_progress" ? "In progress" : "Resolved"}
        </Badge>
      </div>

      {isStaff ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated p-3">
          <label className="text-sm text-fg-muted">Status</label>
          <Select
            className="w-44"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            disabled={changingStatus}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button onClick={changeStatus} disabled={changingStatus || newStatus === ticket.status} type="button">
            {changingStatus && <Spinner />} Update
          </Button>
        </div>
      ) : (
        ticket.status !== "resolved" && (
          <Button variant="secondary" onClick={selfResolve} disabled={changingStatus} type="button">
            {changingStatus && <Spinner />} Mark as resolved
          </Button>
        )
      )}

      {/* Thread */}
      <div className="space-y-3">
        {ticket.messages.map((m) => {
          const isStaffAuthor = m.authorIsStaff;
          const label = isStaffAuthor ? "Support" : m.author?.orgName || "You";
          return (
            <div key={m.id} className="rounded-xl border border-border bg-bg-elevated p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg">{label}</span>
                <span className="text-xs text-fg-muted">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              {isStaffAuthor && <Badge tone="neutral" className="mb-2">Staff</Badge>}
              <p className="whitespace-pre-wrap text-sm text-fg">{m.body}</p>
            </div>
          );
        })}
      </div>

      {/* Reply box */}
      <div className="rounded-xl border border-border bg-bg-elevated p-4">
        <label className="mb-1 block text-sm font-medium text-fg">Reply</label>
        {sendingError && (
          <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sendingError}</div>
        )}
        <Textarea
          rows={4}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type your reply…"
          maxLength={5000}
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={sendReply} disabled={sending || !reply.trim()} type="button">
            {sending && <Spinner />} Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}