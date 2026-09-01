import { Badge, Card } from "@/components/ui";

export interface DeviceView {
  agent_id: string;
  hostname: string;
  status: "online" | "offline" | "overdue";
  last_seen: string;
}

const STATUS_META: Record<
  DeviceView["status"],
  { tone: "success" | "danger" | "warning"; label: string }
> = {
  online: { tone: "success", label: "Online" },
  offline: { tone: "danger", label: "Offline" },
  overdue: { tone: "warning", label: "Overdue" },
};

export function DeviceCard({ device }: { device: DeviceView }) {
  const meta = STATUS_META[device.status] ?? STATUS_META.offline;
  return (
    <Card className="flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
            />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{device.hostname}</p>
          <p className="text-xs font-mono text-gray-500">{device.agent_id}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <p className="text-xs text-gray-400">Last seen {device.last_seen}</p>
      </div>
    </Card>
  );
}