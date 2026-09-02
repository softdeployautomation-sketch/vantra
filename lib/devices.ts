import "server-only";

import { randomUUID } from "crypto";

import { createSite } from "./trmm";

/**
 * V4 Add Device: each device gets its own freshly-created TRMM Site named by the
 * customer (e.g. "Mum's Laptop"), replacing the old "one shared Default Site"
 * model. The customer-facing name is suffixed with a fresh uuid so the TRMM-side
 * Site name is unique-by-construction (safe to match by exact name again).
 *
 * @returns the new Site's TRMM id.
 */
export async function createDeviceSite(
  clientId: number,
  deviceName: string,
): Promise<number> {
  return createSite({
    clientId,
    name: deviceName,
    uniqueSuffix: randomUUID(),
  });
}