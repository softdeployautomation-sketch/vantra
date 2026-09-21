import type { Metadata } from "next";

import { SupportContactForm } from "@/components/support-contact-form";

export const metadata: Metadata = { title: "Contact support" };

// Task 69, scope 5 — public, unauthenticated contact page. Linked from the
// login page ("locked out? contact us") and the EXE's splash/expired states
// for users with no working session at all.
export default function SupportContactPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <div className="mb-6 text-xl font-bold text-brand-600">Vantra</div>
      <div className="w-full max-w-md">
        <SupportContactForm />
      </div>
    </div>
  );
}
