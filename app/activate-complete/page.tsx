"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Card, Spinner } from "@/components/ui";

// Self-service redesign (2026-09-19) — the return hop from the hosted app's
// Settings self-service card (components/exe-license-self-service.tsx). That
// card mints+binds a license using this device's auto-detected Device ID
// (handed to it via exe-gate.tsx's `deviceId`/`returnOrigin` query params —
// see that file for why the local EXE no longer blocks navigation on
// activation), then redirects HERE with the finished key so this device can
// finish activating itself locally, with no manual copy-paste anywhere in
// the loop. Served only by the bundled EXE runtime — on the hosted web build
// /api/exe-license/activate 404s (isLocalExeRuntime() gate), so visiting this
// path there just falls through to the "continue anyway" link below.
const HOSTED_APP_URL = "https://vantra.spaceworker.top";

function ActivateCompleteInner() {
  const params = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const key = params.get("key");
    const email = params.get("email");
    if (!key || !email) {
      window.location.replace(`${HOSTED_APP_URL}/workspace?source=exe`);
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/exe-license/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ licenseKey: key, email }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(
            typeof data.error === "string"
              ? data.error
              : "Could not finish activating this device.",
          );
          return;
        }
      } catch {
        setError("Network error — could not finish activating this device.");
        return;
      }
      window.location.replace(`${HOSTED_APP_URL}/workspace?source=exe`);
    })();
  }, [params]);

  if (error) {
    return (
      <Card className="w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-fg">Couldn&apos;t finish activation</h2>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        <a
          href={`${HOSTED_APP_URL}/workspace?source=exe`}
          className="mt-4 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          Continue to Vantra anyway
        </a>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md p-6 text-center">
      <Spinner className="h-6 w-6" />
      <p className="mt-3 text-sm text-fg-muted">Finishing activation…</p>
    </Card>
  );
}

export default function ActivateCompletePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }} className="bg-bg">
      <Suspense
        fallback={
          <Card className="w-full max-w-md p-6 text-center">
            <Spinner className="h-6 w-6" />
          </Card>
        }
      >
        <ActivateCompleteInner />
      </Suspense>
    </main>
  );
}
