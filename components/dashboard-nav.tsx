"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

export function DashboardNav({ isStaff }: { isStaff: boolean }) {
  const pathname = usePathname();

  const items: Array<{
    href: string;
    label: string;
    active: boolean;
    badge?: string;
  }> = [
    {
      href: "/dashboard",
      label: "Devices",
      // /dashboard and /dashboard/devices/[agentId] are both "Devices".
      active: pathname === "/dashboard" || pathname.startsWith("/dashboard/devices"),
    },
  ];

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            item.active
              ? "bg-brand-50 text-brand-700"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
          )}
        >
          <span>{item.label}</span>
          {item.badge && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
              {item.badge}
            </span>
          )}
        </Link>
      ))}
      {isStaff && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Staff access — Technician Tools appear on each device page.
        </div>
      )}
    </nav>
  );
}