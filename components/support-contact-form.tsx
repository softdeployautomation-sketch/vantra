"use client";

import { useState } from "react";

import { Button, Card, Input, Label, Spinner, Textarea } from "@/components/ui";

// Task 69, scope 5 — the locked-out support form. UNAUTHENTICATED by design:
// a user who lost their password AND has no working license/device has no
// session to send, so this never touches /api/tickets (session-gated).
// Posts email + message to /api/support-contact and says plainly what
// happens next (staff reach out by email).
export function SupportContactForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/support-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't send your message — try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-fg">Message received</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Thanks — our team will reach out to <span className="font-medium text-fg">{email}</span> by
          email shortly. If you do have an account, they may point you at password reset or the regular
          support tickets from there.
        </p>
      </Card>
    );
  }

  return (
    <Card className={compact ? "p-4" : "p-6"}>
      <h2 className="text-base font-semibold text-fg">Locked out? Contact us</h2>
      <p className="mt-1 text-sm text-fg-muted">
        No login needed — tell us the email on your account (or the one you want us to reply to) and
        what&apos;s wrong. We&apos;ll get back to you by email.
      </p>
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        {error ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        <div>
          <Label htmlFor="support-contact-email">Email</Label>
          <Input
            id="support-contact-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <Label htmlFor="support-contact-message">What&apos;s wrong?</Label>
          <Textarea
            id="support-contact-message"
            required
            minLength={10}
            maxLength={5000}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="I lost access to my account — …"
          />
        </div>
        <Button type="submit" disabled={sending} className="w-full">
          {sending ? <Spinner /> : null} Send message
        </Button>
      </form>
    </Card>
  );
}
