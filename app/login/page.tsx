import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // This page never checked for an existing session — a visitor with a
  // perfectly valid vantra_session cookie (e.g. opening a fresh tab and
  // landing here via a bookmark or the nav's own "Login" link) always saw
  // the login form again, which reads exactly like "it logged me out," even
  // though the session itself was fine the whole time (same bug confirmed
  // and fixed in the SpaceWorker repo the same day — a cookie-only request
  // to /dashboard succeeds without issue). Same gap, same fix, mirrored in
  // app/signup/page.tsx. app/dashboard/layout.tsx's own getCurrentUser()
  // gate still runs after this and correctly routes an unverified or
  // no-org session to /verify or /onboarding instead of the dashboard.
  if (await getSession()) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <Link href="/" className="mb-6 text-xl font-bold text-brand-600">
        Vantra
      </Link>
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-elevated p-8 shadow-sm">
        <h1 className="text-xl font-bold text-fg">Welcome back</h1>
        <p className="mt-1 text-sm text-fg-muted">Sign in to your dashboard.</p>
        <div className="mt-6">
          <Suspense>
            <AuthForm mode="login" />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-sm text-fg-muted">
          Locked out?{" "}
          <Link href="/support-contact" className="font-medium text-brand-600 hover:underline">
            Contact us without signing in
          </Link>
        </p>
        <p className="mt-6 text-center text-sm text-fg-muted">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-brand-600 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}