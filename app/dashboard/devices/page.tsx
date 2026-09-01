import type { Metadata } from "next";

import { AddDevicePageClient } from "@/components/add-device-page-client";

export const metadata: Metadata = { title: "Add Device" };

export const dynamic = "force-dynamic";

export default function AddDevicePage() {
  return <AddDevicePageClient />;
}