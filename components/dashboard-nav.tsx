"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LifeBuoy, Monitor, PlusCircle, Settings, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}

export function DashboardNav({ isStaff }: { isStaff: boolean }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      href: "/dashboard",
      label: "Devices",
      icon: Monitor,
      // Device list + device detail (single-path-segment under /devices).
      // Excludes the literal /add route below.
      active:
        pathname === "/dashboard" ||
        /^\/dashboard\/devices\/[^/]+$/.test(pathname),
    },
    {
      href: "/dashboard/devices/add",
      label: "Add Device",
      icon: PlusCircle,
      active: pathname === "/dashboard/devices/add",
    },
    {
      href: "/dashboard/settings",
      label: "Settings",
      icon: Settings,
      active: pathname === "/dashboard/settings",
    },
    {
      href: "/dashboard/support",
      label: "Support",
      icon: LifeBuoy,
      active: pathname.startsWith("/dashboard/support"),
    },
  ];

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            item.active
              ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
              : "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      ))}
      {isStaff && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/30 dark:text-amber-300">
          Staff access — Remote Tools appear on each device page.
        </div>
      )}
    </nav>
  );
}