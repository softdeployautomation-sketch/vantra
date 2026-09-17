import type { Metadata } from "next";

import { OpsConsole } from "@/components/admin/ops-console";

export const metadata: Metadata = { title: "Console · Ops Console" };

export const dynamic = "force-dynamic";

// The unified Ops Console — the one place to manage both instaweb products on
// this box (Vantra + SpaceWorker). Task 41. "/admin101" now redirects straight
// here once logged in, so this is the day-to-day front door of the admin panel.
export default function ConsolePage() {
  return <OpsConsole />;
}