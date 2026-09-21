import "server-only";

import { db } from "./db";
import { env } from "./env";
import { isPrivateTier, normalizeAgentDomainTier } from "./agent-domains";
import {
  moveAgentToSite,
  type DeviceMoveResult,
  type SendCmdOpts,
} from "./trmm";

// Task 62 companion: resolves "which TRMM site + which hostname" a move
// targets, and enforces the one-way direction (public → private only).
// Auth (admin vs owner-owns-destination-private-org) stays in Task 63's
// endpoint / Task 64's sweep — this helper only validates org state.

export interface MoveDestination {
  siteId: number;
  apiBaseUrl: string;
}

export async function resolveMoveDestination(
  destinationOrgId: string,
): Promise<MoveDestination> {
  const dest = await db.organization.findUnique({
    where: { id: destinationOrgId },
    select: { id: true, agentDomainTier: true, trmmSiteId: true },
  });
  if (!dest) throw new Error("Destination organization not found.");
  if (!isPrivateTier(dest.agentDomainTier)) {
    throw new Error("Moves are only allowed into a private organization.");
  }
  if (!dest.trmmSiteId) throw new Error("Destination organization is not provisioned yet.");
  return { siteId: dest.trmmSiteId, apiBaseUrl: env.trmmPrivateApiBaseUrl };
}

/** Guards the source side: the agent's current org must be public-tier. */
export async function assertPublicMoveSource(sourceOrgId: string): Promise<void> {
  const src = await db.organization.findUnique({
    where: { id: sourceOrgId },
    select: { id: true, agentDomainTier: true },
  });
  if (!src) throw new Error("Source organization not found.");
  if (normalizeAgentDomainTier(src.agentDomainTier) !== "public") {
    throw new Error("Only devices in a public organization can be moved.");
  }
}

export type { DeviceMoveResult };

/**
 * Shared Task 62 entry point Task 63/64 call: validates direction
 * (public source → private destination), resolves the destination
 * site/hostname, then runs the two-step move.
 */
export async function moveDeviceToPrivate(
  agentId: string,
  sourceOrgId: string,
  destinationOrgId: string,
  runCommand?: (opts: SendCmdOpts) => Promise<string>,
): Promise<DeviceMoveResult> {
  await assertPublicMoveSource(sourceOrgId);
  const dest = await resolveMoveDestination(destinationOrgId);
  return moveAgentToSite(agentId, dest, runCommand);
}
