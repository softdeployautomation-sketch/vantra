"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/toast";
import { Select } from "@/components/ui";

export interface AssignableStaff {
  id: string;
  email: string;
}

/**
 * Admin "Assign to" picker for a single ticket. Reused on both the admin
 * tickets list and the ticket detail page so assignment behavior never drifts.
 *
 * Changing the dropdown PATCHes /api/admin/tickets/[ticketId] with the chosen
 * staff id (or null when cleared/"Unassigned"), then refreshes so the page
 * re-reads the server-rendered assignment. Reassign and unassign both work —
 * there's no one-way assignment.
 */
export function AdminTicketAssign({
  ticketId,
  assignedStaffId,
  staff,
}: {
  ticketId: string;
  assignedStaffId: string | null;
  staff: AssignableStaff[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [working, setWorking] = useState(false);

  async function assign(next: string) {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/tickets/${encodeURIComponent(ticketId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignedStaffId: next || null }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push(data.error ?? "Couldn't update assignment.", "error");
        return;
      }
      router.refresh();
    } catch {
      toast.push("Network error. Please try again.", "error");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Select
      value={assignedStaffId ?? ""}
      onChange={(e) => assign(e.target.value)}
      disabled={working}
      className="w-56"
    >
      <option value="">Unassigned</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.email}
        </option>
      ))}
    </Select>
  );
}