import type { Metadata } from "next";

import { AdminDevicesClient, type AdminDeviceOrgRow } from "@/components/admin/admin-devices-client";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Admin · Devices" };

export const dynamic = "force-dynamic";

// Deliberately NOT in components/admin/admin-shell.tsx's NAV_ITEMS — reachable
// only by typing this exact URL. Task 44 req #11 (bulk admin remote cmd/
// PowerShell execution, single-customer-scoped) is powerful enough that the
// owner asked for it to stay unlisted, on top of the existing admin-passcode
// gate, until it's been proven working (2026-09-19). The client component
// adds a second layer: everything below a plain, unlabeled checkbox stays
// unrendered until it's checked.
export default async function AdminDevicesPage() {
  const orgs = await db.organization.findMany({
    where: { trmmClientId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { owner: { select: { email: true } } },
  });

  const rows: AdminDeviceOrgRow[] = orgs.map((o) => ({
    orgId: o.id,
    orgName: o.name,
    ownerEmail: o.owner.email,
    trmmClientId: o.trmmClientId as number,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Devices</h1>
      <AdminDevicesClient orgs={rows} />
    </div>
  );
}
