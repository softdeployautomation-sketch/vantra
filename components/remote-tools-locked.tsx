"use client";

import Link from "next/link";

import { Card } from "@/components/ui";

/**
 * Locked upsell state shown on the always-present Remote Tools tab when the
 * viewer isn't Premium. This is a customer-facing Premium feature (NOT
 * staff-gated) — free users still see the tab so the feature's existence is
 * visible, but get this card instead of the tools.
 */
export function RemoteToolsLocked() {
  return (
    <Card className="p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      <h3 className="mt-4 text-base font-semibold text-fg">Remote Tools</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-fg-muted">
        Remotely control your devices — screen share, terminal, send commands and
        more. Remote Tools is included with Vantra Premium.
      </p>
      <Link
        href="/dashboard/settings#wallet"
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        Add funds &amp; activate Premium
      </Link>
    </Card>
  );
}