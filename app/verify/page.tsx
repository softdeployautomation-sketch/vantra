import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { VerifyForm } from "@/components/verify-form";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = params.email ?? "";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <Link href="/" className="mb-6 text-xl font-bold text-brand-600">
        Vantra
      </Link>
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">Check your email</h1>
        <p className="mt-1 text-sm text-gray-600">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-gray-900">{email || "your inbox"}</span>.
          Enter it below to activate your account.
        </p>
        <div className="mt-6">
          <Suspense>
            <VerifyForm email={email} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}