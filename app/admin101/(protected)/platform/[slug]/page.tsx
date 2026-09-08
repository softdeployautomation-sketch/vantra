import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminPlatformDetailClient,
  PLATFORM_META,
  type BackgroundJobView,
  type PlatformKey,
  type ServiceStateView,
} from "@/components/admin/admin-platform-detail-client";
import { listBackgroundJobs } from "@/lib/background-jobs";
import { listServiceStates } from "@/lib/services-control";

export const dynamic = "force-dynamic";

function isPlatformKey(value: string): value is PlatformKey {
  return value === "vantra" || value === "spaceworker";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const title = isPlatformKey(slug) ? PLATFORM_META[slug].title : "Platform";
  return { title: `Admin · ${title}` };
}

export default async function AdminPlatformDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isPlatformKey(slug)) notFound();

  let initialServices: ServiceStateView[] | null = null;
  try {
    initialServices = await listServiceStates();
  } catch (err) {
    console.error("listServiceStates failed:", err);
  }

  let initialJobs: BackgroundJobView[] | null = null;
  try {
    initialJobs = await listBackgroundJobs();
  } catch (err) {
    console.error("listBackgroundJobs failed:", err);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">{PLATFORM_META[slug].title}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Services and background jobs that belong to this platform, with the
        same start/stop/restart controls as the VPS tab.
      </p>
      <div className="mt-6">
        <AdminPlatformDetailClient
          platform={slug}
          initialServices={initialServices}
          initialJobs={initialJobs}
        />
      </div>
    </div>
  );
}
