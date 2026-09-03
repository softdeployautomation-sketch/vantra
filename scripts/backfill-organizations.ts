/**
 * One-time data backfill for the multi-org foundation.
 *
 * Timeline (matches CLINE_TASK_MULTI_ORG_FOUNDATION.md):
 *   1. Apply migration 20260905000000_add_organizations
 *   2. Run this script (against production, from the Vantra app dir)
 *   3. Apply migration 20260911000000_drop_legacy_user_fields
 *
 * Between step 1 and step 2 the DB has BOTH the legacy User columns
 * (trmmClientId/trmmSiteId/plan/premiumExpiresAt/orgName) and the new
 * Organization table + organizationId FKs. The Prisma client generated from the
 * FINAL schema no longer models the legacy columns, so this script reads/writes
 * them via raw SQL ($queryRaw) rather than the typed client.
 *
 * For every User row with a non-null trmmClientId it:
 *   - creates ONE Organization copying trmmClientId/trmmSiteId/plan/
 *     premiumExpiresAt/orgName -> name,
 *   - re-points that user's Deployment / Script / DeviceGroup rows from userId
 *     to the new organizationId,
 *   - sets User.activeOrgId to the new org's id,
 * and prints row-count verification (orgs created == users with a client id).
 *
 * Run: npx tsx scripts/backfill-organizations.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

interface LegacyUser {
  id: string;
  email: string;
  trmmClientId: number | null;
  trmmSiteId: number | null;
  plan: string | null;
  premiumExpiresAt: Date | null;
  orgName: string | null;
}

async function main() {
  console.log("Backfill: starting at", new Date().toISOString());

  const users = await db.$queryRaw<LegacyUser[]>`
    SELECT id, email, "trmmClientId", "trmmSiteId", "plan", "premiumExpiresAt", "orgName"
    FROM "User"
    WHERE "trmmClientId" IS NOT NULL
  `;

  const toBackfill = users.filter((u) => u.trmmClientId != null);
  console.log(`Backfill: ${toBackfill.length} user(s) with a TRMM client to migrate.`);

  let segment = 0;
  for (const user of toBackfill) {
    segment++;
    await backfillUser(user, segment, toBackfill.length);
  }

  // ---- Verification ----
  const orgRows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Organization"`;
  const clientRows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "User" WHERE "trmmClientId" IS NOT NULL`;
  const orgsCreated = Number(orgRows[0].count);
  const usersWithClient = Number(clientRows[0].count);

  console.log("\n=== Verification ===");
  console.log(`Organizations created overall:   ${orgsCreated}`);
  console.log(`Users with a TRMM client before:  ${usersWithClient}`);

  const missingRows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "User" u
    WHERE u."trmmClientId" IS NOT NULL
      AND (u."activeOrgId" IS NULL
           OR NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = u."activeOrgId" AND o.ownerId = u.id))
  `;
  const missing = Number(missingRows[0].count);
  console.log(`Migrated users missing an active org: ${missing}`);

  // Belt-and-suspenders: migration 20260911000000 will hard-fail on
  // `organizationId SET NOT NULL` if any row was left unpointed, but that's a
  // much later, less legible failure than catching it here right after the
  // backfill ran. Any row still userId-scoped for a migrated user means this
  // script's per-user UPDATEs missed something.
  const unpointedRows = await db.$queryRaw<Array<{ deploys: bigint; scripts: bigint; groups: bigint }>>`
    SELECT
      (SELECT COUNT(*)::bigint FROM "Deployment" d JOIN "User" u ON u.id = d."userId" WHERE u."trmmClientId" IS NOT NULL AND d."organizationId" IS NULL) AS deploys,
      (SELECT COUNT(*)::bigint FROM "Script" s JOIN "User" u ON u.id = s."userId" WHERE u."trmmClientId" IS NOT NULL AND s."organizationId" IS NULL) AS scripts,
      (SELECT COUNT(*)::bigint FROM "DeviceGroup" g JOIN "User" u ON u.id = g."userId" WHERE u."trmmClientId" IS NOT NULL AND g."organizationId" IS NULL) AS groups
  `;
  const unpointed = unpointedRows[0];
  console.log(
    `Rows still unpointed (userId-only): deployments=${unpointed.deploys}, ` +
      `scripts=${unpointed.scripts}, groups=${unpointed.groups}`,
  );
  assert.equal(Number(unpointed.deploys), 0, "Every Deployment row for a migrated user must have organizationId set.");
  assert.equal(Number(unpointed.scripts), 0, "Every Script row for a migrated user must have organizationId set.");
  assert.equal(Number(unpointed.groups), 0, "Every DeviceGroup row for a migrated user must have organizationId set.");

  if (orgsCreated >= usersWithClient) {
    console.log("OK: every migrated client now has at least one Organization row.");
  } else {
    throw new Error(
      `MISMATCH: ${usersWithClient} clients but only ${orgsCreated} organizations created.` +
        ` Expected orgsCreated >= usersWithClient.`,
    );
  }
  assert.equal(missing, 0, "Every migrated user must have an active Organization.");

  await db.$disconnect();
  console.log("Backfill complete.");
}
async function backfillUser(
  user: LegacyUser,
  segment: number,
  total: number,
): Promise<void> {
  // Idempotency: if this user already has an org (re-run), don't create a
  // duplicate — just re-point any stragglers and ensure activeOrgId.

  const existing = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Organization" WHERE "ownerId" = ${user.id} ORDER BY "createdAt" ASC LIMIT 1
  `;
  const orgId = existing[0]?.id ?? randomUUID();
  const orgName =
    user.orgName && user.orgName.trim().length > 0 ? user.orgName : "My Organization";


  await db.$transaction([
    // Create the org (no-op if it already exists from a prior run).
    db.$executeRaw`
      INSERT INTO "Organization" ("id", "ownerId", "name", "trmmClientId", "trmmSiteId", "plan", "premiumExpiresAt", "createdAt")
      VALUES (${orgId}, ${user.id}, ${orgName}, ${user.trmmClientId}, ${user.trmmSiteId}, ${user.plan ?? "free"}, ${user.premiumExpiresAt}, NOW())
      ON CONFLICT ("id") DO NOTHING
    `,
    // Re-point owned rows from userId -> organizationId.

    db.$executeRaw`UPDATE "Deployment" SET "organizationId" = ${orgId} WHERE "userId" = ${user.id} AND "organizationId" IS NULL`,
    db.$executeRaw`UPDATE "Script"     SET "organizationId" = ${orgId} WHERE "userId" = ${user.id} AND "organizationId" IS NULL`,
    db.$executeRaw`UPDATE "DeviceGroup" SET "organizationId" = ${orgId} WHERE "userId" = ${user.id} AND "organizationId" IS NULL`,
    // Point the user at the new org as its active/default.

    db.$executeRaw`UPDATE "User" SET "activeOrgId" = ${orgId} WHERE "id" = ${user.id}`,
  ]);

  // Per-user verification counts. 
  const rows = await db.$queryRaw<Array<{ deploys: bigint; scripts: bigint; groups: bigint }>>`
    SELECT
      (SELECT COUNT(*)::bigint FROM "Deployment" WHERE "organizationId" = ${orgId})  AS deploys,
      (SELECT COUNT(*)::bigint FROM "Script"     WHERE "organizationId" = ${orgId})  AS scripts,
      (SELECT COUNT(*)::bigint FROM "DeviceGroup" WHERE "organizationId" = ${orgId}) AS groups
  `;
  const r = rows[0];
 
  console.log(
    `  [${segment}/${total}] ${user.email} -> org ${orgId.slice(0, 8)}… ` +
      `(client=${user.trmmClientId}, deployments=${r.deploys}, scripts=${r.scripts}, groups=${r.groups})`,
  );
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  await db.$disconnect();
  process.exit(1);
});