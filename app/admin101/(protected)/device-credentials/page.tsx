import type { Metadata } from "next";

import { AdminDeviceCredentialsClient } from "@/components/admin/admin-device-credentials-client";

export const metadata: Metadata = { title: "Admin · Device Credentials" };

export const dynamic = "force-dynamic";

// Task 45 — admin visibility (read-only) into the device-credential trail:
// which devices hold a stored unlock code, which requests are in-flight
// (incl. the unattended scheduled next-boot ones), and the audit log of who
// requested/stored/revealed what. The row data is fetched by the client
// component from GET /api/admin/device-credentials; no credential value is
// ever displayed here — this is an accountability surface, not a reveal path.
export default async function AdminDeviceCredentialsPage() {
  return (
    <div>
      <AdminDeviceCredentialsClient />
    </div>
  );
}