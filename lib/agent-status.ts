// Single source of truth for agent-status → Badge tone/label mapping.
// Previously duplicated in device-card.tsx and agent-detail-client.tsx.
export type AgentStatus = "online" | "offline" | "overdue";

export interface AgentStatusMeta {
  tone: "success" | "danger" | "warning";
  label: string;
}

export const AGENT_STATUS_META: Record<AgentStatus, AgentStatusMeta> = {
  online: { tone: "success", label: "Online" },
  offline: { tone: "danger", label: "Offline" },
  overdue: { tone: "warning", label: "Overdue" },
};

export function agentStatusMeta(status?: string): AgentStatusMeta {
  return AGENT_STATUS_META[status as AgentStatus] ?? AGENT_STATUS_META.offline;
}