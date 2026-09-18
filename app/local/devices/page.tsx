import type { Metadata } from "next";

import { LocalDevices } from "@/components/local-devices";

export const metadata: Metadata = {
  title: "My devices",
  robots: { index: false, follow: false },
};

// Task 44.4 — the desktop EXE's local devices surface. Served by the bundled
// runtime at /local/devices; the Tauri window navigates here (instead of the
// hosted dashboard) after the license gate passes. Reads + writes the local
// SQLite mirror only — works fully offline. Deliberately OUTSIDE the hosted
// Shell layout (/dashboard) since that layout is not served in the EXE runtime.
export default function LocalDevicesPage() {
  return (
    <main
      className="flex h-screen flex-col bg-bg"
      style={{ minHeight: "100vh" }}
    >
      <LocalDevices />
    </main>
  );
}