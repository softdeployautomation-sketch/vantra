"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export function SettingsForm({
  initialOrgName,
  email,
}: {
  initialOrgName: string;
  email: string;
}) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(initialOrgName);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save your settings.");
        return;
      }
      setSuccess(true);
      // Refresh so the header reflects the new org name.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Organization</h2>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Settings saved.
            </div>
          )}
          <div>
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value);
                setSuccess(false);
              }}
              placeholder="Acme Inc."
              maxLength={80}
              autoComplete="organization"
            />
            <p className="mt-1 text-xs text-fg-muted">
              Shown in your dashboard header.
            </p>
          </div>
          <Button
            type="submit"
            disabled={loading || orgName.trim().length < 2}
          >
            {loading && <Spinner />}
            Save changes
          </Button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Account</h2>
        <div className="mt-4">
          <Label>Email</Label>
          <p className="text-sm text-fg">{email}</p>
          <p className="mt-1 text-xs text-fg-muted">
            Changing your login email is not available yet.
          </p>
        </div>
      </Card>

      <Card className="flex items-center justify-between p-6">
        <div>
          <h2 className="text-base font-semibold text-fg">Theme</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Dark is the default; toggle to your preference.
          </p>
        </div>
        <ThemeToggle />
      </Card>
    </div>
  );
}