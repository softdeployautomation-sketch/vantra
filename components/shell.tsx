import Link from "next/link";

import { DashboardNav } from "@/components/dashboard-nav";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";

interface ShellProps {
  children: React.ReactNode;
  orgName: string;
}

export function Shell({ children, orgName }: ShellProps) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-bg-elevated/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-lg font-bold text-brand-600 dark:text-brand-400">
              Vantra
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        {/* Vertical sidebar (md+); the same links are offered inline on mobile. */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-border px-3 py-6 md:flex">
          {orgName && (
            <div className="mb-4 rounded-lg border border-border bg-bg-elevated px-3 py-2.5">
              <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-fg-muted">
                Organization
              </div>
              <div className="mt-1 truncate text-sm font-medium text-fg" title={orgName}>
                {orgName}
              </div>
            </div>
          )}
          <DashboardNav />
        </aside>

        <div className="flex-1 min-w-0">
          {/* Mobile nav row */}
          <div className="px-4 pt-4 md:hidden">
            {orgName && (
              <div className="mb-3 rounded-lg border border-border bg-bg-elevated px-3 py-2">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-fg-muted">
                  Organization
                </div>
                <div className="mt-0.5 truncate text-sm font-medium text-fg" title={orgName}>
                  {orgName}
                </div>
              </div>
            )}
            <div className="flex overflow-x-auto rounded-lg border border-border bg-bg-elevated px-2 py-2">
              <DashboardNav variant="mobile" />
            </div>
          </div>
          <main className="px-4 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}