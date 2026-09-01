import Link from "next/link";

import { Button } from "@/components/ui";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <span className="text-lg font-bold text-brand-600">Vantra</span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Sign in
            </Link>
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-gradient-to-b from-brand-50 to-white py-24">
          <div className="mx-auto max-w-3xl px-4 text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
              Keep every device online.{" "}
              <span className="text-brand-600">All from one dashboard.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600">
              Vantra gives you a secure, branded portal to add devices, monitor
              live status, and get installation links — without ever touching
              the underlying infrastructure.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Link href="/signup">
                <Button className="px-6 py-3 text-base">
                  Create your account
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="secondary" className="px-6 py-3 text-base">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto grid max-w-5xl gap-6 px-4 sm:grid-cols-3">
            {[
              {
                title: "One-click enrollment",
                body: "Generate secure installation links for Windows devices in seconds.",
              },
              {
                title: "Live status",
                body: "See online, offline, and overdue device health in real time.",
              },
              {
                title: "Secure by design",
                body: "Email verification and server-side rate limiting keep your fleet protected.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-base font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 py-8">
        <p className="text-center text-sm text-gray-500">
          © {new Date().getFullYear()} Vantra. All rights reserved.
        </p>
      </footer>
    </div>
  );
}