import "server-only";

import { createHash, timingSafeEqual } from "crypto";

import { db } from "@/lib/db";
import { getActiveOrganization } from "@/lib/session-user";
import { laterParty } from "@/lib/local-db/clock";

// Task 44.4, increment 2 — the cloud MIRROR / COORDINATOR helper (design §4, D3).
// Sits behind /api/desktop/sync/* (hosted, HTTPS), authenticating each request by
// its per-install identity (install_id + machine_id, D6) — NOT a web session. The
// EXE's local engine (lib/local-db/sync.ts) is the exact counterpart: it pushes
// outbox rows here and pulls a cursor delta back, and both sides apply the SAME
// LWW-with-deterministic-tie-break rule (laterParty) so write order never matters.

/** Outbox row the EXE pushes up. */
export interface PushRow {
  id: string;
  entity: "desktop_device" | "desktop_label";
  action: "upsert" | "delete";
  data: Record<string, unknown>;
}

export class MirrorAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

/** A resolved (auto-registered on first contact) install with its org scope. */
export interface ResolvedInstall {
  id: string;
  installId: string;
  userId: string;
  organizationId: string | null;
  machineId: string;
  deviceCursor: string | null;
}

/**
 * Resolves the caller's DesktopInstall or auto-registers it the first time it
 * calls home. An install is only admitted once the machine holds a machine-BOUND
 * ExeLicense (product "vantra_exe") — that proof is what links the install to the
 * buyer's User + Organization for scoping. Returns without any DB write when the
 * install is already known.
 */
export async function resolveInstall(
  installId: string | null | undefined,
  machineId: string | null | undefined,
  installSecret: string | null | undefined,
): Promise<ResolvedInstall> {
  if (!installId || !machineId) {
    throw new MirrorAuthError("Missing x-install-id / x-machine-id", 401);
  }
  // Task 46 — the install secret is the actual credential now. A correct
  // machineId alone is no longer sufficient proof of identity for either a NEW
  // or an EXISTING install: the mirror only admits callers who also present the
  // high-entropy secret the server minted at bind time and the EXE stored
  // locally. A missing value fails closed (never an implicit null-match).
  if (!installSecret || installSecret.trim().length === 0) {
    throw new MirrorAuthError("Missing x-install-secret", 401);
  }
  const cleanId = installId.trim().toLowerCase();
  const cleanMid = machineId.trim().toLowerCase();
  const secretHash = sha256Hex(installSecret.trim());

  // Resolve the machine-BOUND ExeLicense this install must prove. Checked for
  // BOTH new and already-registered installs, so an install whose secret was
  // rotated away by a transfer/unbind can't keep reading or writing.
  const bound = await db.exeLicense.findFirst({
    where: { boundMachineId: cleanMid, product: "vantra_exe" },
    select: { userId: true, installSecretHash: true },
  });
  if (!bound) {
    throw new MirrorAuthError(
      "This machine has no active bound Vantra EXE license — register/activate first",
      403,
    );
  }
  // No stored hash — a pre-fix license that was never re-bound (and so never got
  // a secret minted) cannot authenticate. Re-binding mints a fresh secret and
  // re-enables sync; until then the mirror is closed to it.
  if (!bound.installSecretHash || !secretMatches(bound.installSecretHash, secretHash)) {
    throw new MirrorAuthError("Invalid install identity", 401);
  }

  const existing = await db.desktopInstall.findUnique({ where: { installId: cleanId } });
  if (existing) {
    if (existing.machineId.toLowerCase() !== cleanMid) {
      throw new MirrorAuthError("Install id is bound to a different machine", 403);
    }
    return {
      id: existing.id,
      installId: existing.installId,
      userId: existing.userId,
      organizationId: existing.organizationId,
      machineId: existing.machineId,
      deviceCursor: existing.deviceCursor,
    };
  }

  // First contact — the secret already proved ownership of the machine-bound
  // license above; scope the new install to that license's user/org.
  const user = await db.user.findUnique({ where: { id: bound.userId } });
  const organization = user ? await getActiveOrganization(user) : null;

  const created = await db.desktopInstall.create({
    data: {
      installId: cleanId,
      machineId: cleanMid,
      userId: bound.userId,
      organizationId: organization?.id ?? null,
    },
  });
  return {
    id: created.id,
    installId: created.installId,
    userId: created.userId,
    organizationId: created.organizationId,
    machineId: created.machineId,
    deviceCursor: created.deviceCursor,
  };
}

/** sha256 hex digest (used for the at-rest install-secret hash). */
function sha256Hex(text: string): string {
  const h = createHash("sha256");
  h.update(text, "utf8");
  return Buffer.from(h.digest()).toString("hex");
}

/** Constant-time compare of two lowercase sha256 hex digests. */
function secretMatches(a: string, b: string): boolean {
  const ab = Buffer.from(a.toLowerCase(), "utf8");
  const bb = Buffer.from(b.toLowerCase(), "utf8");
  if (ab.length !== bb.length) return false; // timingSafeEqual requires equal lengths
  return timingSafeEqual(ab, bb);
}

/**
 * Applies one pushed outbox row to the org's DesktopDeviceMirror with the shared
 * LWW rule. Returns true when the EXE's change was accepted (acked → the local side
 * clears its outbox row + dirty flag); false when the mirror's row is strictly newer
 * and the pull will reconcile it down instead.
 */
export async function applyPushRow(
  install: ResolvedInstall,
  row: PushRow,
  nowIso: string,
): Promise<boolean> {
  const orgId = install.organizationId;
  const agentId = String(row.data.agent_id ?? "");
  if (!agentId) return false;
  if (!orgId) return false; // no org binding yet — nothing to scope to

  const incomingTs = String(row.data.updated_at ?? row.data.deleted_at ?? nowIso) || nowIso;
  // The EXE's writes are keyed by install identity so two installs tie-break
  // deterministically (and the server's own "server" origin sorts last, D5).
  const origin = install.installId;

  const existing = await db.desktopDeviceMirror.findUnique({
    where: { organizationId_agentId: { organizationId: orgId, agentId } },
  });

  const localWins =
    !existing ||
    laterParty(
      { updatedAt: incomingTs, origin },
      { updatedAt: existing.updatedAt.toISOString(), origin: existing.origin },
    ) > 0;

  if (!localWins) return false; // mirror is newer — don't clobber, let pull reconcile

  // A delete is a tombstone claim.
  if (row.action === "delete") {
    const deletedAt = String(row.data.deleted_at ?? nowIso);
    await db.desktopDeviceMirror.upsert({
      where: { organizationId_agentId: { organizationId: orgId, agentId } },
      create: {
        organizationId: orgId,
        agentId,
        updatedAt: new Date(deletedAt),
        origin,
        deletedAt: new Date(deletedAt),
      },
      update: {
        deletedAt: new Date(deletedAt),
        updatedAt: new Date(deletedAt),
        origin,
      },
    });
    return true;
  }

  const d = row.data;
  await db.desktopDeviceMirror.upsert({
    where: { organizationId_agentId: { organizationId: orgId, agentId } },
    create: {
      organizationId: orgId,
      agentId,
      hostname: nullable(d.hostname),
      status: nullable(d.status),
      lastSeen: nullable(d.last_seen),
      operatingSystem: nullable(d.operating_system),
      siteName: nullable(d.site_name),
      monType: nullable(d.mon_type),
      goarch: nullable(d.goarch),
      installMethod: nullable(d.install_method),
      msiReady: intOrNull(d.msi_ready),
      provisionUrl: nullable(d.provision_url),
      expiresAt: nullable(d.expires_at),
      label: nullable(d.label),
      notes: nullable(d.notes),
      tags: nullable(d.tags),
      updatedAt: new Date(incomingTs),
      origin,
      deletedAt: null,
    },
    update: {
      hostname: nullable(d.hostname),
      status: nullable(d.status),
      lastSeen: nullable(d.last_seen),
      operatingSystem: nullable(d.operating_system),
      siteName: nullable(d.site_name),
      monType: nullable(d.mon_type),
      goarch: nullable(d.goarch),
      installMethod: nullable(d.install_method),
      msiReady: intOrNull(d.msi_ready),
      provisionUrl: nullable(d.provision_url),
      expiresAt: nullable(d.expires_at),
      label: nullable(d.label),
      notes: nullable(d.notes),
      tags: nullable(d.tags),
      updatedAt: new Date(incomingTs),
      origin,
      deletedAt: null, // an upsert revives a tombstoned row (newer clock wins)
    },
  });
  return true;
}
/**
 * Pulls the org's desktop_device delta since the install's stored cursor and advances
 * it. Returns payload rows (the SAME ServerDevice shape the local applyServerDevice
 * expects) plus the next cursor ISO string.
 */
export async function pullDelta(
  install: ResolvedInstall,
): Promise<{ rows: Record<string, unknown>[]; nextCursor: string }> {
  const orgId = install.organizationId;
  const cursorTs = install.deviceCursor ? new Date(install.deviceCursor) : new Date(0);
  const sinceIso = cursorTs.toISOString();

  const rows = orgId
    ? await db.desktopDeviceMirror.findMany({
        where: { organizationId: orgId, updatedAt: { gt: cursorTs } },
        orderBy: { updatedAt: "asc" },
        take: 500,
      })
    : [];

  const mapped = rows.map((r) => ({
    agent_id: r.agentId,
    organization_id: r.organizationId,
    hostname: r.hostname,
    status: r.status,
    last_seen: r.lastSeen,
    operating_system: r.operatingSystem,
    site_name: r.siteName,
    mon_type: r.monType,
    goarch: r.goarch,
    install_method: r.installMethod,
    msi_ready: r.msiReady,
    provision_url: r.provisionUrl,
    expires_at: r.expiresAt,
    label: r.label,
    notes: r.notes,
    tags: r.tags,
    origin: r.origin,
    updated_at: r.updatedAt.toISOString(),
    deleted_at: r.deletedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  }));

  const nextCursor = rows.length > 0 ? mapped[rows.length - 1].updated_at : sinceIso;
  await db.desktopInstall.update({
    where: { id: install.id },
    data: { deviceCursor: nextCursor, lastSyncAt: new Date() },
  });
  return { rows: mapped, nextCursor };
}

function nullable(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : String(v);
}
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}