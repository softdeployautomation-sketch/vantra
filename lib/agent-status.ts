// Single source of truth for agent-status → Badge tone/label mapping.
// Previously duplicated in device-card.tsx and agent-detail-client.tsx.
export type AgentStatus = "online" | "offline" | "overdue";

export interface AgentStatusMeta {
  tone: "success" | "danger" | "warning";
  label: string;
  description: string;
}

export const AGENT_STATUS_META: Record<AgentStatus, AgentStatusMeta> = {
  online: {
    tone: "success",
    label: "Online",
    description: "Checked in within its expected window.",
  },
  offline: {
    tone: "danger",
    label: "Offline",
    description:
      "Reported an explicit offline/shutdown state, or returned a status outside the normal online/overdue pair.",
  },
  // TRMM's "overdue" is the everyday "this device hasn't checked in" signal —
  // in practice it's what real "offline" devices actually report (a distinct
  // explicit offline status is rare/never seen), so it's shown identically to
  // "offline" rather than as its own separate, confusing third state.
  overdue: {
    tone: "danger",
    label: "Offline",
    description:
      "Hasn't checked in within its expected window — usually means the device is powered off, asleep, or has lost its network connection.",
  },
};

export function agentStatusMeta(status?: string): AgentStatusMeta {
  return AGENT_STATUS_META[status as AgentStatus] ?? AGENT_STATUS_META.offline;
}