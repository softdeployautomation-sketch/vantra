import { redirect } from "next/navigation";

// Landing dashboard for the admin panel. Task 41 made the Ops Console
// (/admin101/console) the day-to-day front door, so the bare "/admin101" landing
// now funnels straight into it (bookmarks/muscle memory keep working; they just
// land on the console now). The old Platform-status content lives inside the
// console's Vantra side.
export default function AdminIndexPage() {
  redirect("/admin101/console");
}