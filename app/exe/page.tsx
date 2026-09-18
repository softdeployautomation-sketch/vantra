import type { Metadata } from "next";

import { ExeGate } from "@/components/exe-gate";

export const metadata: Metadata = {
  title: "Desktop",
  robots: { index: false, follow: false },
};

// Task 44.3 — local license-gate surface. This page is served ONLY by the
// bundled EXE runtime (exe/runtime/) as the window's initial screen. It tells
// the gate to check the local license and then gets the user over to the hosted
// app.
export default function ExePage() {
  return (
    <main
      style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
      className="bg-bg"
    >
      <ExeGate />
    </main>
  );
}