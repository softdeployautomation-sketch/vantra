import Link from "next/link";

import { DashboardNav } from "@/components/dashboard-nav";
import { DeviceNetworkBackground } from "@/components/device-network-background";
import { LogoutButton } from "@/components/logout-button";
import { OrgSwitcher } from "@/components/org-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

interface OrgOption {
  id: string;
  name: string;
}

interface ShellProps {
  children: React.ReactNode;
  activeOrg: OrgOption;
  organizations: OrgOption[];
}

export function Shell({ children, activeOrg, organizations }: ShellProps) {
  return (
    <div className="relative min-h-screen">
      {/* Static ambient device-network behind everything. */}
      <DeviceNetworkBackground />

      <div className="relative">
        <header className="sticky top-0 z-40 border-b border-border bg-bg-elevated/65 backdrop-blur-md">
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
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-border bg-bg/45 px-3 py-6 backdrop-blur-md md:flex">
            <OrgSwitcher activeOrg={activeOrg} organizations={organizations} />
            <DashboardNav />
          </aside>

          <div className="flex-1 min-w-0">
            {/* Mobile nav row */}
            <div className="px-4 pt-4 md:hidden">
              <div className="mb-3 md:hidden">
                <OrgSwitcher activeOrg={activeOrg} organizations={organizations} />
              </div>
              <div className="flex overflow-x-auto rounded-lg border border-border bg-bg-elevated px-2 py-2">
                <DashboardNav variant="mobile" />
              </div>
            </div>
            <main className="px-4 py-8">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}