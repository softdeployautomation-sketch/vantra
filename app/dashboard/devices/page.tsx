import { redirect } from "next/navigation";

// Backward-compat shim: Add Device moved to /dashboard/devices/add.
// The old URL also read like a device list, so redirect to the real list too.
export default function DevicesIndexPage() {
  redirect("/dashboard");
}