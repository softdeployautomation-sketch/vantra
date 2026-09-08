import type { Metadata } from "next";

import { AdminBackgroundJobsClient, type BackgroundJobView } from "@/components/admin/admin-background-jobs-client";
import { listBackgroundJobs } from "@/lib/background-jobs";

export const metadata: Metadata = { title: "Admin · Background Jobs" };

export const dynamic = "force-dynamic";

export default async function AdminBackgroundJobsPage() {
  let initial: BackgroundJobView[] | null = null;
  try {
    initial = await listBackgroundJobs();
  } catch (err) {
    console.error("listBackgroundJobs failed:", err);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Background Jobs</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Every recurring job that runs on this box outside of a request —
        including the nightly database backup — with when it last ran and
        whether it succeeded.
      </p>
      <div className="mt-6">
        <AdminBackgroundJobsClient initial={initial} />
      </div>
    </div>
  );
}
