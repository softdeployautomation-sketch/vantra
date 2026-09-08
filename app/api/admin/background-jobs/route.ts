import { NextResponse } from "next/server";

import { logApiError } from "@/lib/api-error-log";
import { requireAdminSession } from "@/lib/admin-auth";
import { listBackgroundJobs } from "@/lib/background-jobs";

export const dynamic = "force-dynamic";

// Read-only — no POST here. Unlike /api/admin/services, none of these jobs are
// meant to be manually triggered from the admin (a job dispatcher fired on
// demand mid-review, or a nightly backup kicked off by hand outside its
// window, isn't a control this page needs to offer).
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    return NextResponse.json({ jobs: await listBackgroundJobs() });
  } catch (err) {
    console.error("listBackgroundJobs failed:", err);
    await logApiError({
      route: "/api/admin/background-jobs",
      method: "GET",
      statusCode: 502,
      error: err,
    });
    return NextResponse.json(
      { error: "Couldn't read background job state right now." },
      { status: 502 },
    );
  }
}
