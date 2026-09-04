import Link from "next/link";

import {
  Activity,
  LifeBuoy,
  Monitor,
  MousePointerClick,
  ShieldCheck,
  TerminalSquare,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Badge, Button } from "@/components/ui";

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Create your account",
    body: "Sign up and confirm your email in under a minute — no sales calls, no waiting on a technician.",
  },
  {
    title: "Generate an installer",
    body: "Pick a device in “Add Device” and get a secure, expiring download link for Windows.",
  },
  {
    title: "Run it on the device",
    body: "Double-click the installer. The Vantra agent enrolls automatically and starts reporting.",
  },
  {
    title: "Monitor, script, and support",
    body: "Watch live status, run your own scripts, and open tickets — all from one dashboard.",
  },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Activity,
    title: "Live device status",
    body: "See online and offline device health in real time across your whole fleet.",
  },
  {
    icon: MousePointerClick,
    title: "One-click Windows enrollment",
    body: "Generate secure installation links in seconds and have new machines reporting within minutes.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by design",
    body: "Email verification and server-side rate limiting keep your fleet protected. You never touch the raw infrastructure.",
  },
  {
    icon: TerminalSquare,
    title: "Your own scripts",
    body: "Write PowerShell, cmd, or Bash scripts, save them once, and run them on any of your devices.",
  },
  {
    icon: Workflow,
    title: "Remote tools",
    body: "Staff can open remote control, terminal, and file managers right from a device page when you need a hand.",
  },
  {
    icon: LifeBuoy,
    title: "Built-in support tickets",
    body: "Open a ticket, follow the thread, and track open, in-progress, and resolved statuses.",
  },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Which operating systems are supported?",
    a: "Windows is fully supported today. macOS and Linux are on the roadmap and appear in the Add Device screen as coming soon.",
  },
  {
    q: "Do I need technical IT skills?",
    a: "No. Enrollment is a single installer double-click. Everything else — status, scripts, support — is designed to be usable by non-technical owners while staying powerful enough for technicians.",
  },
  {
    q: "Is my data isolated from other customers?",
    a: "Yes. Each account maps to its own isolated slice of our shared infrastructure, and access controls are enforced server-side. You never see another customer’s devices or data.",
  },
  {
    q: "Can your team manage my devices remotely?",
    a: "Staff can open remote control, a terminal, or a file manager directly from your device page — clearly marked as staff-managed access whenever it’s used.",
  },
  {
    q: "How does email verification work?",
    a: "We email you a six-digit code when you sign up. Entering it unlocks your dashboard — a simple layer that keeps your fleet from being created under an unverified address.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="sticky top-0 z-40 border-b border-border bg-bg-elevated/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <span className="text-lg font-bold text-brand-600 dark:text-brand-400">Vantra</span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-fg-muted hover:text-fg">
              Sign in
            </Link>
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-b from-brand-50 to-bg dark:from-brand-900/20 dark:to-bg">
          <div className="mx-auto max-w-5xl px-4 py-20 sm:py-28">
            <div className="text-center">
              <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
                Keep every device online.{" "}
                <span className="text-brand-600 dark:text-brand-400">All from one dashboard.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-lg text-fg-muted">
                Vantra is the branded portal for your fleet — add Windows
                devices, watch live status, run scripts, and get support, without
                ever touching the underlying infrastructure.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/signup">
                  <Button className="px-6 py-3 text-base">Create your account</Button>
                </Link>
                <Link href="/login">
                  <Button variant="secondary" className="px-6 py-3 text-base">
                    Sign in
                  </Button>
                </Link>
              </div>
            </div>

            {/* Live-product preview mockup */}
            <div className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-xl">
              <div className="flex items-center gap-1.5 border-b border-border bg-bg px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2 text-xs text-fg-muted">app.vantra.dev/dashboard</span>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-fg">Your devices</h3>
                  <Button className="h-8 px-3 text-xs" type="button">
                    Add Device
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-3">
                    <div className="flex items-center gap-3">
                      <Monitor className="h-5 w-5 text-fg-muted" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-fg">DESKTOP-LIVE</p>
                        <p className="text-xs text-fg-muted">Windows · Last seen just now</p>
                      </div>
                    </div>
                    <Badge tone="success">Online</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-3">
                    <div className="flex items-center gap-3">
                      <Monitor className="h-5 w-5 text-fg-muted" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-fg">SALES-LAPTOP</p>
                        <p className="text-xs text-fg-muted">Windows · Last seen 12 min ago</p>
                      </div>
                    </div>
                    <Badge tone="danger">Offline</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-3">
                    <div className="flex items-center gap-3">
                      <Monitor className="h-5 w-5 text-fg-muted" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-fg">BACKOFFICE-PC</p>
                        <p className="text-xs text-fg-muted">Windows · Enrolled last week</p>
                      </div>
                    </div>
                    <Badge tone="danger">Offline</Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* How it works */}
        <section className="py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">How it works</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-fg-muted">
              From signup to a monitored fleet in about five minutes.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
                  className="relative rounded-xl border border-border bg-bg-elevated p-6 shadow-sm"
                >
                  <span className="absolute right-4 top-4 text-3xl font-extrabold text-brand-200 dark:text-brand-900/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-base font-semibold text-fg">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="bg-bg-elevated py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">Everything your fleet needs</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-fg-muted">
              The monitoring, automation, and support you’d expect — without the
              infrastructure headaches.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-xl border border-border bg-bg p-6 shadow-sm">
                  <f.icon className="h-6 w-6 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  <h3 className="mt-3 text-base font-semibold text-fg">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        {/* FAQ */}
        <section className="py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">Frequently asked questions</h2>
            <div className="mt-8 space-y-3">
              {FAQS.map((f) => (
                <details key={f.q} className="group rounded-xl border border-border bg-bg-elevated p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-fg">
                    {f.q}
                    <span className="ml-4 text-fg-muted transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-fg-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-border bg-gradient-to-b from-brand-50 to-bg py-16 dark:from-brand-900/20 dark:to-bg">
          <div className="mx-auto max-w-2xl px-4 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">Ready to take control of your fleet?</h2>
            <p className="mx-auto mt-3 max-w-lg text-fg-muted">
              Create your account, add a device, and see the whole picture today.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup">
                <Button className="px-6 py-3 text-base">Get started free</Button>
              </Link>
              <Link href="/login">
                <Button variant="secondary" className="px-6 py-3 text-base">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-5xl px-4 text-center">
          <p className="text-sm text-fg-muted">© {new Date().getFullYear()} Vantra. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}