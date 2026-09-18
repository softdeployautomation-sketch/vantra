import type { Metadata } from "next";

import { WorkspaceShell } from "@/components/workspace-shell";

export const metadata: Metadata = { title: "Workspace" };

// Deliberately outside app/dashboard/ (same reasoning as /console/[agentId])
// so it does NOT inherit the full Shell layout -- this page IS the app frame
// (a tab bar), not content inside one. No server-side auth check here: this
// page itself shows nothing sensitive, just tab chrome + iframes; each tab's
// iframe (starting with the Dashboard tab's /dashboard) already enforces its
// own auth via the existing dashboard layout's getCurrentUser() redirect, so
// an unauthenticated visit naturally shows the real sign-in form INSIDE the
// Dashboard tab rather than needing a second, duplicate check here.
export default function WorkspacePage() {
  return <WorkspaceShell />;
}
