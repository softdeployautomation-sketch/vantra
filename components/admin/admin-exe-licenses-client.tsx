"use client";

import { useCallback, useState } from "react";

import { useToast } from "@/components/toast";
import { Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";

export type AdminExeLicenseTransfer = {
  id: string;
  fromMachineId: string;
  fromMachineLabel: string | null;
  toMachineId: string;
  toMachineLabel: string | null;
  transferredAt: Date | string;
};

export type AdminExeLicense = {
  id: string;
  user: { id: string; email: string };
  product: string;
  licenseKey: string;
  issuedAt: Date | string;
  boundMachineId: string | null;
  boundMachineLabel: string | null;
  boundLicenseKey: string | null;
  boundAt: Date | string | null;
  lastCheckinAt: Date | string | null;
  transfers: AdminExeLicenseTransfer[];
};

/** Relative "last seen" label — the whole point of lastCheckinAt is a quick
 * at-a-glance read of whether a bound machine is actually alive. */
function checkinLabel(value: Date | string | null | undefined): string {
  if (!value) return "Never checked in";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "Never checked in";
  const minutes = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "Checked in just now";
  if (minutes < 60) return `Checked in ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Checked in ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Checked in ${days}d ago`;
}

function dateLabel(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Short, copy-safe key display for the list. */
function shortKey(key: string): string {
  if (key.length <= 34) return key;
  return `${key.slice(0, 17)}…${key.slice(-17)}`;
}

async function json(res: Response) {
  return res.json().catch(() => ({}));
}

export function AdminExeLicensesClient({
  initialEmail,
  licenses: initialLicenses,
}: {
  initialEmail: string;
  licenses: AdminExeLicense[];
}) {
  const toast = useToast();

  const [licenses, setLicenses] = useState<AdminExeLicense[]>(initialLicenses);
  const [email, setEmail] = useState(initialEmail);
  const [loadingList, setLoadingList] = useState(false);

  const [issueEmail, setIssueEmail] = useState("");
  const [durationDays, setDurationDays] = useState("180");
  const [overrideEligibility, setOverrideEligibility] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [issuedNote, setIssuedNote] = useState<string | null>(null);

  const [claimId, setClaimId] = useState<string | null>(null);
  const [machineId, setMachineId] = useState("");
  const [machineLabel, setMachineLabel] = useState("");
  const [claiming, setClaiming] = useState(false);

  // Transfer is a SEPARATE action from claim/bind — bind only ever works on an
  // unbound license (first claim); transfer moves an ALREADY-bound one to a
  // new device. Kept as distinct UI state so the two can't be confused.
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferMachineId, setTransferMachineId] = useState("");
  const [transferMachineLabel, setTransferMachineLabel] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);

  // Unbind — support/testing reset: clears a binding entirely, no replacement
  // device (unlike transfer, which always requires a target machine).
  const [unbindingId, setUnbindingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Page is force-dynamic and re-rendered server-side; state initializes from the
  // server props on mount and the admin filters by email client-side via `load()`.
  const load = useCallback(
    async (targetEmail?: string, refocus = false) => {
      setError(null);
      setLoadingList(true);
      try {
        const q = encodeURIComponent((targetEmail ?? email).trim());
        const res = await fetch(`/api/admin/exe-licenses${q ? `?email=${q}` : ""}`, {
          cache: "no-store",
        });
        const data = await json(res);
        if (!res.ok) {
          setError(data.error ?? "Couldn't load licenses.");
          return;
        }
        setLicenses(data.licenses ?? []);
        if (refocus) {
          setIssuedKey(null);
          setIssuedNote(null);
        }
      } catch {
        setError("Network error while loading licenses.");
      } finally {
        setLoadingList(false);
      }
    },
    [email],
  );

  async function issue() {
    setError(null);
    setIssuedKey(null);
    setIssuedNote(null);
    const days = Number(durationDays);
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      setError("Term must be between 1 and 3650 days.");
      return;
    }
    setIssuing(true);
    try {
      const res = await fetch("/api/admin/exe-licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue",
          email: issueEmail,
          durationDays: days,
          overrideEligibility,
          overrideReason:
            overrideEligibility && overrideReason.trim()
              ? overrideReason.trim()
              : undefined,
        }),
      });
      const data = await json(res);
      if (!res.ok) {
        setError(data.error ?? "Couldn't issue the license.");
        return;
      }
      setIssuedKey(data.exeLicense?.licenseKey ?? null);
      setIssuedNote(data.mustClaimNote ?? null);
      toast.push(
        data.reused
          ? "This buyer already has a usable license — reused it instead of creating a duplicate."
          : "License issued — remember to claim it to the buyer's device.",
        "success",
      );
      await load();
    } catch {
      setError("Network error while issuing the license.");
    } finally {
      setIssuing(false);
    }
  }

  async function claim() {
    if (!claimId) return;
    setError(null);
    if (!machineId.trim()) {
      setError("Enter the buyer's Device ID (from Settings → Licenses in the EXE).");
      return;
    }
    setClaiming(true);
    try {
      const res = await fetch("/api/admin/exe-licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bind",
          exeLicenseId: claimId,
          machineId,
          machineLabel: machineLabel.trim() ? machineLabel.trim() : null,
        }),
      });
      const data = await json(res);
      if (!res.ok) {
        setError(data.error ?? "Couldn't claim the license.");
        return;
      }
      toast.push("License locked to that device — the buyer can now activate it.", "success");
      setClaimId(null);
      setMachineId("");
      setMachineLabel("");
      await load();
    } catch {
      setError("Network error while claiming the license.");
    } finally {
      setClaiming(false);
    }
  }

  async function transfer() {
    if (!transferId) return;
    setError(null);
    if (!transferMachineId.trim()) {
      setError("Enter the new Device ID to transfer this license to.");
      return;
    }
    setTransferring(true);
    try {
      const res = await fetch("/api/admin/exe-licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer",
          exeLicenseId: transferId,
          machineId: transferMachineId,
          machineLabel: transferMachineLabel.trim() ? transferMachineLabel.trim() : null,
        }),
      });
      const data = await json(res);
      if (!res.ok) {
        setError(data.error ?? "Couldn't transfer the license.");
        return;
      }
      toast.push(
        "License moved to the new device. The old device's activation isn't revoked until it next checks in online.",
        "success",
      );
      setTransferId(null);
      setTransferMachineId("");
      setTransferMachineLabel("");
      await load();
    } catch {
      setError("Network error while transferring the license.");
    } finally {
      setTransferring(false);
    }
  }

  async function unbind(id: string) {
    if (
      !window.confirm(
        "Clear this license's device binding? The current machine's key stops working immediately, and the license goes back to unclaimed.",
      )
    ) {
      return;
    }
    setError(null);
    setUnbindingId(id);
    try {
      const res = await fetch("/api/admin/exe-licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unbind", exeLicenseId: id }),
      });
      const data = await json(res);
      if (!res.ok) {
        setError(data.error ?? "Couldn't unbind the license.");
        return;
      }
      toast.push("License unbound — it's unclaimed again and ready for a fresh bind.", "success");
      await load();
    } catch {
      setError("Network error while unbinding the license.");
    } finally {
      setUnbindingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">EXE Licenses</h1>
        <p className="mt-1 text-sm text-gray-500">
          Issue a Vantra EXE license, then claim (bind) it to one specific device. Until a
          license is claimed, the EXE will reject the key at activation.
        </p>
      </div>
<Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Issue a new license</h2>
        {issuedKey && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-800">
              License issued — copy it and send it to the buyer:
            </p>
            <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs text-gray-800">
              {issuedKey}
            </code>
            <p className="mt-2 text-xs text-emerald-700">
              {issuedNote ??
                "This key is unbound. Claim it to a device before the buyer activates it, or the EXE will reject it."}
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <Label htmlFor="issue-email">Buyer email</Label>
            <Input
              id="issue-email"
              type="email"
              value={issueEmail}
              onChange={(e) => setIssueEmail(e.target.value)}
              placeholder="buyer@example.com"
              autoComplete="off"
            />
          </div>
          <div className="sm:col-span-1">
            <Label htmlFor="issue-days">Term (days)</Label>
            <Input
              id="issue-days"
              type="number"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              min={1}
              max={3650}
            />
          </div>
          <div className="flex items-end sm:col-span-1">
            <Button type="button" onClick={issue} disabled={issuing}>
              {issuing && <Spinner />} Issue license
            </Button>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={overrideEligibility}
              onChange={(e) => setOverrideEligibility(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">
              Issue anyway — the buyer is <strong>not</strong> premium and not
              staff. Requires a real reason (recorded for audit).
            </span>
          </label>
          {overrideEligibility && (
            <Input
              className="mt-2"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. Founding partner — promised access"
              maxLength={300}
              autoComplete="off"
            />
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="shrink-0" htmlFor="filter-email">
            Buyer email
          </Label>
          <Input
            id="filter-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            className="min-w-0 flex-1"
            autoComplete="off"
          />
          <Button type="button" onClick={() => load(undefined, true)} disabled={loadingList}>
            {loadingList && <Spinner />} Search
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEmail("");
              setLicenses(initialLicenses);
            }}
          >
            Clear
          </Button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">
          Licenses {loadingList && <Spinner className="ml-1 inline" />}
        </h2>
{licenses.length === 0 ? (
          <p className="text-sm text-gray-500">
            {email.trim() ? "No licenses for that buyer yet." : "No licenses issued yet."}
          </p>
        ) : (
          <ul className="space-y-3">
            {licenses.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{l.user.email}</span>
                  <Badge>{l.product}</Badge>
                  <code className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                    {shortKey(l.licenseKey)}
                  </code>
                </div>
                <p className="mt-1 text-xs text-gray-500">Issued {dateLabel(l.issuedAt)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {l.boundMachineId ? (
                    <>
                      <Badge tone="success">
                        Bound {dateLabel(l.boundAt)} · {l.boundMachineLabel ?? l.boundMachineId}
                      </Badge>
                      {l.boundLicenseKey && (
                        <code className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                          Activates with {shortKey(l.boundLicenseKey)}
                        </code>
                      )}
                      {/* Live liveness signal (revocation-on-transfer, 2026-09-18) — is
                          the CURRENTLY bound machine actually alive/checking in, or
                          has it gone stale? Distinct from boundAt (the one-time bind
                          event). */}
                      <Badge tone={l.lastCheckinAt ? "success" : "warning"}>
                        {checkinLabel(l.lastCheckinAt)}
                      </Badge>
                    </>
                  ) : (
                    <Badge tone="warning">Unbound</Badge>
                  )}
                  {l.transfers.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setHistoryId(historyId === l.id ? null : l.id)}
                    >
                      {historyId === l.id ? "Hide" : "Show"} transfer history ({l.transfers.length})
                    </Button>
                  )}
                </div>

                {historyId === l.id && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2">
                    {l.transfers.map((t) => (
                      <li key={t.id} className="text-xs text-gray-600">
                        {dateLabel(t.transferredAt)}:{" "}
                        <span className="font-mono">{t.fromMachineLabel ?? t.fromMachineId}</span>
                        {" → "}
                        <span className="font-mono">{t.toMachineLabel ?? t.toMachineId}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {claimId === l.id ? (
                    <div className="mt-2 grid w-full gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`claimKey-${l.id}`}>{"Buyer's Device ID"}</Label>
                        <Input
                          id={`claimKey-${l.id}`}
                          value={machineId}
                          onChange={(e) => setMachineId(e.target.value)}
                          placeholder="e.g. WINDOWS-4F3A-MACHINE-1234"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`claimLbl-${l.id}`}>Label (optional)</Label>
                        <Input
                          id={`claimLbl-${l.id}`}
                          value={machineLabel}
                          onChange={(e) => setMachineLabel(e.target.value)}
                          placeholder="e.g. Marketing PC"
                          autoComplete="off"
                        />
                      </div>
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <Button type="button" onClick={claim} disabled={claiming}>
                          {claiming && <Spinner />} Claim to device
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setClaimId(null);
                            setMachineId("");
                            setMachineLabel("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : transferId === l.id ? (
                    <div className="mt-2 grid w-full gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`transferKey-${l.id}`}>New Device ID</Label>
                        <Input
                          id={`transferKey-${l.id}`}
                          value={transferMachineId}
                          onChange={(e) => setTransferMachineId(e.target.value)}
                          placeholder="e.g. WINDOWS-4F3A-MACHINE-5678"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`transferLbl-${l.id}`}>Label (optional)</Label>
                        <Input
                          id={`transferLbl-${l.id}`}
                          value={transferMachineLabel}
                          onChange={(e) => setTransferMachineLabel(e.target.value)}
                          placeholder="e.g. New laptop"
                          autoComplete="off"
                        />
                      </div>
                      <p className="text-xs text-amber-700 sm:col-span-2">
                        The old device stays activated locally until it next checks in
                        online (usually its next launch) — it isn&apos;t revoked instantly.
                      </p>
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <Button type="button" onClick={transfer} disabled={transferring}>
                          {transferring && <Spinner />} Transfer license
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setTransferId(null);
                            setTransferMachineId("");
                            setTransferMachineLabel("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : l.boundMachineId ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setTransferId(l.id);
                          setTransferMachineId("");
                          setTransferMachineLabel("");
                        }}
                      >
                        Transfer to a new device
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => unbind(l.id)}
                        disabled={unbindingId === l.id}
                      >
                        {unbindingId === l.id && <Spinner />} Unbind
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setClaimId(l.id);
                        setMachineId("");
                        setMachineLabel("");
                      }}
                    >
                      Claim / bind to a device
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}