"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Input, Label, Spinner } from "@/components/ui";

export function OnboardingForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save your organization.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div>
        <Label htmlFor="orgName">Organization name</Label>
        <Input
          id="orgName"
          autoFocus
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Acme Inc."
          maxLength={80}
          autoComplete="organization"
        />
        <p className="mt-1 text-xs text-fg-muted">
          This is shown in your dashboard header. You can change it later.
        </p>
      </div>
      <Button type="submit" disabled={loading || orgName.trim().length === 0} className="w-full">
        {loading && <Spinner />}
        Continue to dashboard
      </Button>
    </form>
  );
}