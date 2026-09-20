"use client";

import { useEffect, useState } from "react";

import { Badge, Td, Th } from "@/components/ui";

// Task 45 — admin visibility into the device-credential trail. READ-ONLY: this
// surfaces which devices hold a stored credential, which requests are in-flight
// (including the unattended scheduled next-boot ones), and the audit log of
// who requested/stored/revealed what and when. No credential value (encrypted or
// otherwise) is ever requested or rendered here — it is an accountability
// surface, not a second reveal path.

type CredentialRow = {
  agentId: string;
  platform: string;
  pinLength: number;
  orgName: string | null;
  requestedByEmail: string | null;
  updatedAt: string;
};

type RequestRow = {
  id: string;
  agentId: string;
  platform: string;
  status: string;
  schedule: string;
  bootDelayMinutes: number;
  timerStartedAt: string | null;
  pinLength: number;
  orgName: string | null;
  actorEmail: string | null;
  createdAt: string;
};

type AuditRow = {
  id: string;
  agentId: string;
  orgName: string | null;
  actorEmail: string | null;
  action: string;
  outcome: string;
  detail: string | null;
  requestId: string | null;
  createdAt: string;
};

const AUDIT_FILTERS = [
  { id: "all", label: "All" },
  { id: "DEVICE_CREDENTIAL_REQUESTED", label: "Requested" },
  { id: "DEVICE_CREDENTIAL_STORED", label: "Stored" },
  { id: "DEVICE_CREDENTIAL_RETRIEVED", label: "Revealed" },
] as const;

function badgeForRequest(status: string): "danger" | "warning" | "neutral" {
  if (status === "waiting_20_minutes") return "warning";
  if (status === "pending_next_boot") return "warning";
  return "neutral";
}

export function AdminDeviceCredentialsClient() {
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditFilter, setAuditFilter] = useState<(typeof AUDIT_FILTERS)[number]["id"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/device-credentials");
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setCredentials(Array.isArray(data.credentials) ? data.credentials : []);
          setRequests(Array.isArray(data.requests) ? data.requests : []);
          setAudit(Array.isArray(data.audit) ? data.audit : []);
        } else {
          setError(typeof data.error === "string" ? data.error : "Failed to load device credentials");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredAudit =
    auditFilter === "all" ? audit : audit.filter((a) => a.action === auditFilter);

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight text-fg">Device Credentials</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Read-only visibility into stored unlock codes, in-flight requests, and the request/store/reveal
        audit trail. No PIN values are ever shown here.
      </p>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="mt-6 text-sm text-fg-muted">Loading…</p>
      ) : (
        <>
          <section className="mt-6">
            <h3 className="text-lg font-semibold text-fg">Stored credentials</h3>
            <p className="text-xs text-fg-muted">
              Devices that currently hold a stored (encrypted) unlock code on file.
            </p>
            {credentials.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">None stored.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
                <table className="min-w-full divide-y divide-border text-left text-sm">
                  <thead>
                    <tr>
                      <Th>Device</Th>
                      <Th>Organization</Th>
                      <Th>Platform</Th>
                      <Th>PIN length</Th>
                      <Th>Requested by</Th>
                      <Th>Updated</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {credentials.map((c) => (
                      <tr key={c.agentId}>
                        <Td className="font-mono text-xs">{c.agentId}</Td>
                        <Td className="text-fg-muted">{c.orgName ?? "—"}</Td>
                        <Td className="uppercase">{c.platform}</Td>
                        <Td>{c.pinLength} digits</Td>
                        <Td className="text-fg-muted">{c.requestedByEmail ?? "—"}</Td>
                        <Td className="text-fg-muted">{new Date(c.updatedAt).toLocaleString()}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-8">
            <h3 className="text-lg font-semibold text-fg">In-flight requests</h3>
            <p className="text-xs text-fg-muted">
              Open requests — including unattended scheduled next-boot ones still awaiting the device.
            </p>
            {requests.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">None open.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
                <table className="min-w-full divide-y divide-border text-left text-sm">
                  <thead>
                    <tr>
                      <Th>Device</Th>
                      <Th>Organization</Th>
                      <Th>Status</Th>
                      <Th>Schedule</Th>
                      <Th>Boot delay</Th>
                      <Th>Timer started</Th>
                      <Th>Requested by</Th>
                      <Th>Created</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <Td className="font-mono text-xs">{r.agentId}</Td>
                        <Td className="text-fg-muted">{r.orgName ?? "—"}</Td>
                        <Td>
                          <Badge tone={badgeForRequest(r.status)}>{r.status}</Badge>
                        </Td>
                        <Td className="uppercase">{r.schedule}</Td>
                        <Td className="text-fg-muted">
                          {r.schedule === "next_boot" ? `${r.bootDelayMinutes} min` : "—"}
                        </Td>
                        <Td className="text-fg-muted">
                          {r.timerStartedAt ? new Date(r.timerStartedAt).toLocaleString() : "—"}
                        </Td>
                        <Td className="text-fg-muted">{r.actorEmail ?? "—"}</Td>
                        <Td className="text-fg-muted">{new Date(r.createdAt).toLocaleString()}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-fg">Audit trail</h3>
              <div className="flex gap-1">
                {AUDIT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setAuditFilter(f.id)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      auditFilter === f.id
                        ? "bg-brand-600 text-white"
                        : "text-fg-muted hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-fg-muted">
              {filteredAudit.length} of the most recent {audit.length} actions.
            </p>
            {filteredAudit.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">No matching audit rows.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-bg-elevated">
                <table className="min-w-full divide-y divide-border text-left text-sm">
                  <thead>
                    <tr>
                      <Th>Action</Th>
                      <Th>Device</Th>
                      <Th>Organization</Th>
                      <Th>Actor</Th>
                      <Th>Outcome</Th>
                      <Th>Detail</Th>
                      <Th>When</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredAudit.map((a) => (
                      <tr key={a.id}>
                        <Td className="font-mono text-xs">{a.action}</Td>
                        <Td className="font-mono text-xs">{a.agentId}</Td>
                        <Td className="text-fg-muted">{a.orgName ?? "—"}</Td>
                        <Td className="text-fg-muted">{a.actorEmail ?? "—"}</Td>
                        <Td>
                          <Badge tone={a.outcome === "ok" ? "success" : "danger"}>{a.outcome}</Badge>
                        </Td>
                        <Td className="max-w-[240px] text-xs text-fg-muted">{a.detail ?? "—"}</Td>
                        <Td className="text-fg-muted">{new Date(a.createdAt).toLocaleString()}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}