import type { Metadata } from "next";

import { AdminExeArtifactsClient } from "@/components/admin/admin-exe-artifacts-client";

export const metadata: Metadata = { title: "Admin · EXE Artifacts" };

export const dynamic = "force-dynamic";

export default async function AdminExeArtifactsPage() {
  return <AdminExeArtifactsClient />;
}