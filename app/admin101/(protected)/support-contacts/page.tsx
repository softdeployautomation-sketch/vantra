import type { Metadata } from "next";

import { AdminSupportContactsClient } from "@/components/admin/admin-support-contacts-client";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Admin · Support Contacts" };

export const dynamic = "force-dynamic";

// Task 69, scope 5 — admin surface for the locked-out triage inbox.
export default async function AdminSupportContactsPage() {
  const contacts = await db.supportContact.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <AdminSupportContactsClient
      initial={contacts.map((c) => ({
        id: c.id,
        email: c.email,
        message: c.message,
        createdAt: c.createdAt.toISOString(),
        resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      }))}
    />
  );
}
