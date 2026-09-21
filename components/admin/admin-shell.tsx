"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/admin101/console", label: "Console", exact: true },
  { href: "/admin101/background-jobs", label: "Background Jobs" },
  { href: "/admin101/users", label: "Users" },
  { href: "/admin101/tickets", label: "Tickets" },
  { href: "/admin101/support-contacts", label: "Support Contacts" },
  { href: "/admin101/payments", label: "Payments" },
  { href: "/admin101/device-credentials", label: "Device Creds" },
  { href: "/admin101/errors", label: "Errors" },
  { href: "/admin101/notifications", label: "Notifications" },
  { href: "/admin101/wallets", label: "Wallets & Pricing" },
  { href: "/admin101/exe-licenses", label: "EXE Licenses" },
  { href: "/admin101/exe-artifacts", label: "EXE Artifacts" },
  { href: "/admin101/vps", label: "VPS" },
  { href: "/admin101/status", label: "Status" },
];

// "Console" (`/admin101/console`) is the Ops Console — the day-to-day front door
// (Task 41). It's matched exactly so its prefix doesn't bleed onto the other
// admin items, and it ships first so it's the most prominent entry in the sidebar.
type NavItem = (typeof NAV_ITEMS)[number];
function isActive(item: NavItem, pathname: string): boolean {
  if ("exact" in item && item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      const res = await fetch("/api/admin/logout", { method: "POST" });
      if (!res.ok) toast.push("Couldn't log out — try again.", "error");
    } catch {
      toast.push("Network error while logging out.", "error");
    } finally {
      setLoggingOut(false);
    }
    router.push("/admin101/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-bg-elevated/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin101/console"
              className="text-lg font-bold text-brand-600 dark:text-brand-400"
            >
              instaweb admin
            </Link>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5"
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-48 shrink-0 flex-col border-r border-border px-3 py-6 md:flex">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive(item, pathname)
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                    : "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="px-4 pt-4 md:hidden">
            <div className="flex overflow-x-auto rounded-lg border border-border bg-bg-elevated px-2 py-2">
              <nav className="flex flex-row gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive(item, pathname)
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                        : "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
          <main className="px-4 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}