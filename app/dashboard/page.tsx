import type { Metadata } from "next";

import { DashboardClient } from "@/components/dashboard-client";

export const metadata: Metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardClient />;
}