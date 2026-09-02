// Single source of truth for ticket-status → Badge tone/label mapping.
// Badge tones are limited to success/danger/warning/neutral.
export type TicketStatus = "open" | "in_progress" | "resolved";

export interface TicketStatusMeta {
  tone: "success" | "danger" | "warning" | "neutral";
  label: string;
}

export const TICKET_STATUS_META: Record<TicketStatus, TicketStatusMeta> = {
  open: { tone: "warning", label: "Open" },
  in_progress: { tone: "neutral", label: "In progress" },
  resolved: { tone: "success", label: "Resolved" },
};

export function ticketStatusMeta(status?: string): TicketStatusMeta {
  return (
    TICKET_STATUS_META[status as TicketStatus] ?? {
      tone: "neutral",
      label: status ?? "Unknown",
    }
  );
}