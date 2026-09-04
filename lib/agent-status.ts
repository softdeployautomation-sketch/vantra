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
  overdue: {
    tone: "warning",
    label: "Overdue",
    description:
      "Hasn't checked in within its expected window — usually means the device is powered off, asleep, or has lost its network connection.",
  },
};

export function agentStatusMeta(status?: string): AgentStatusMeta {
  return AGENT_STATUS_META[status as AgentStatus] ?? AGENT_STATUS_META.offline;
}