import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding-form";
import { getCurrentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Name your organization" };

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.emailVerified) redirect(`/verify?email=${encodeURIComponent(user.email)}`);
  // Already onboarded — skip the form.
  if (user.orgName) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <Link href="/" className="mb-6 text-xl font-bold text-brand-600">
        Vantra
      </Link>
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-elevated p-8 shadow-sm">
        <h1 className="text-xl font-bold text-fg">Welcome!</h1>
        <p className="mt-1 text-sm text-fg-muted">
          One last step before your dashboard — name your organization.
        </p>
        <div className="mt-6">
          <OnboardingForm />
        </div>
      </div>
    </div>
  );
}