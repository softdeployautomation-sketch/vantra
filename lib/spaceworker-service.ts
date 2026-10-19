import "server-only";

import crypto from "node:crypto";

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

// Task 93 — SpaceWorker plugin provisioning helpers. Every `sw-` org is owned
// by ONE dedicated service user so the org never appears under a real
// customer's Vantra account and a real customer can never self-service into
// it (Task 75's one-org cap counts orgs per owner — the service user is a
// different owner). Org names are deterministic: `sw-<spaceworkerUserId>`,
// which doubles as the idempotency key for repeat provisioning calls.

export const SW_SERVICE_EMAIL = "spaceworker-service@spaceworker.top";
export const SW_ORG_PREFIX = "sw-";

export function swOrgName(spaceworkerUserId: string): string {
  return `${SW_ORG_PREFIX}${spaceworkerUserId}`;
}

/** The private-tier companion org (`sw-<uid>-p`) — see swOrgName above. */
export function swPrivateOrgName(spaceworkerUserId: string): string {
  return `${SW_ORG_PREFIX}${spaceworkerUserId}-p`;
}

export function isSwOrgName(name: string): boolean {
  return name.startsWith(SW_ORG_PREFIX);
}

/**
 * TASK_230 A — derive the owning SpaceWorker user id from a `sw-` org name.
 * Org names are deterministic (swOrgName / swPrivateOrgName above): public is
 * `sw-<uid>`, the private companion is `sw-<uid>-p`. Used to resolve the user's
 * PER-USER public mesh group (attribution by group membership, no schema). A
 * name with neither shape (or a uid that is itself empty) returns null so the
 * caller fails closed rather than guessing a tenant.
 */
export function swUserIdFromOrgName(name: string): string | null {
  if (!isSwOrgName(name)) return null;
  const body = name.slice(SW_ORG_PREFIX.length);
  const uid = body.endsWith("-p") ? body.slice(0, -"-p".length) : body;
  return uid.length > 0 ? uid : null;
}

/** TASK_230 A — true when this `sw-` org is the PUBLIC tier (not the `-p` companion). */
export function isSwPublicOrgName(name: string): boolean {
  return isSwOrgName(name) && !name.slice(SW_ORG_PREFIX.length).endsWith("-p");
}

/** Finds or creates the single service user that owns all `sw-` orgs. */
export async function ensureServiceUser(): Promise<{ id: string }> {
  const existing = await db.user.findUnique({
    where: { email: SW_SERVICE_EMAIL },
    select: { id: true },
  });
  if (existing) return existing;
  // Unguessable random password — nobody ever logs in as this user.
  const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
  const created = await db.user.create({
    data: {
      email: SW_SERVICE_EMAIL,
      passwordHash,
      emailVerified: true,
    },
    select: { id: true },
  });
  return created;
}