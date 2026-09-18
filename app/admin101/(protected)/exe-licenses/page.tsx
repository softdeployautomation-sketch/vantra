import type { Metadata } from "next";

import { AdminExeLicensesClient } from "@/components/admin/admin-exe-licenses-client";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Admin · EXE Licenses" };

export const dynamic = "force-dynamic";

export default async function AdminExeLicensesPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const term = email?.trim() ?? "";

  const licenses = await db.exeLicense.findMany({
    where: term
      ? { user: { email: { equals: term, mode: "insensitive" } } }
      : {},
    orderBy: { issuedAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, email: true } },
      transfers: { orderBy: { transferredAt: "desc" } },
    },
  });

  return <AdminExeLicensesClient initialEmail={term} licenses={licenses} />;
}