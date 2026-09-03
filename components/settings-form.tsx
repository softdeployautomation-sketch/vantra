"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/components/toast";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export function SettingsForm({
  initialOrgName,
  email,
  initialNotifyDeviceOffline,
  initialNotifyTicketReply,
  initialTelegramChatId,
}: {
  initialOrgName: string;
  email: string;
  initialNotifyDeviceOffline: boolean;
  initialNotifyTicketReply: boolean;
  initialTelegramChatId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [orgName, setOrgName] = useState(initialOrgName);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const [notifyDeviceOffline, setNotifyDeviceOffline] = useState(initialNotifyDeviceOffline);
  const [notifyTicketReply, setNotifyTicketReply] = useState(initialNotifyTicketReply);
  const [notifySaving, setNotifySaving] = useState(false);
  const [notifySavingError, setNotifySavingError] = useState<string | null>(null);

  const [telegramChatId, setTelegramChatId] = useState<string | null>(initialTelegramChatId);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  async function connectTelegram() {
    setTelegramError(null);
    setTelegramBusy(true);
    try {
      const res = await fetch("/api/settings/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.linkUrl) {
        setTelegramError(data.error ?? "Couldn't create a Telegram link right now.");
        return;
      }
      window.open(data.linkUrl, "_blank", "noopener,noreferrer");
      toast.push("Open the link in Telegram to connect your account.");
    } catch {
      setTelegramError("Network error. Please try again.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function disconnectTelegram() {
    setTelegramError(null);
    setTelegramBusy(true);
    try {
      const res = await fetch("/api/settings/telegram/link", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTelegramError(data.error ?? "Couldn't disconnect Telegram right now.");
        return;
      }
      setTelegramChatId(null);
      toast.push("Telegram disconnected.");
    } catch {
      setTelegramError("Network error. Please try again.");
    } finally {
      setTelegramBusy(false);
    }
  }

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

  async function saveNotifications() {
    setNotifySavingError(null);
    setNotifySaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyDeviceOffline, notifyTicketReply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotifySavingError(data.error ?? "Couldn't save your notification preferences.");
        return;
      }
      toast.push("Notification preferences saved.");
    } catch {
      setNotifySavingError("Network error while saving preferences.");
    } finally {
      setNotifySaving(false);
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

      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Notifications</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Choose which updates you want to hear about. Connect your Telegram chat
          in the card below to actually receive them.
        </p>
        {notifySavingError && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {notifySavingError}
          </div>
        )}
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={notifyDeviceOffline}
              onChange={(e) => setNotifyDeviceOffline(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Device goes offline</span>
              <span className="block text-xs text-fg-muted">
                Let me know when one of my devices stops reporting.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={notifyTicketReply}
              onChange={(e) => setNotifyTicketReply(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Support replies</span>
              <span className="block text-xs text-fg-muted">
                Email me when staff respond to my tickets.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-4">
          <Button onClick={saveNotifications} disabled={notifySaving} type="button">
            {notifySaving && <Spinner />} Save preferences
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Telegram</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Link your Telegram chat to receive device and support-reply alerts here
          based on your notification preferences above.
        </p>
        {telegramError && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {telegramError}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="text-sm text-fg">
            {telegramChatId ? (
              <span className="font-medium">Connected</span>
            ) : (
              <span className="text-fg-muted">Not connected</span>
            )}
          </span>
          {telegramChatId ? (
            <Button
              variant="secondary"
              onClick={disconnectTelegram}
              disabled={telegramBusy}
              type="button"
            >
              {telegramBusy && <Spinner />} Disconnect
            </Button>
          ) : (
            <Button onClick={connectTelegram} disabled={telegramBusy} type="button">
              {telegramBusy && <Spinner />} Connect Telegram
            </Button>
          )}
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