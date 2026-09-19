import "server-only";

import { getExeDeviceCookie } from "./auth";
import { db } from "./db";
import { EXE_PRODUCT, keyExpiryIsAfter } from "./exe-license";

export interface DesktopModeGate {
  /** True when this account has an active Vantra Desktop binding AND the
   * CURRENT session isn't the bound device — the web dashboard (outside
   * Settings) should be gated for exactly this session. */
  gated: boolean;
  boundMachineLabel: string | null;
  boundMachineId: string | null;
  exeLicenseId: string | null;
}

const UNGATED: DesktopModeGate = {
  gated: false,
  boundMachineLabel: null,
  boundMachineId: null,
  exeLicenseId: null,
};

/**
 * Confirmed live (2026-09-19) — "desktop mode": once an account's Vantra
 * Desktop license is bound to a device, the FULL dashboard (devices,
 * tickets, everything except billing/licensing) narrows to the desktop app
 * per the original spec — a plain web browser session (or any OTHER device)
 * gets redirected to Settings instead, where billing + the license status
 * (and a "Switch back to web" unbind action) still live. The session that
 * genuinely IS the bound device (its exe-device cookie matches) is never
 * gated — this only affects every OTHER way of reaching the account.
 *
 * There is no separate local database here (see lib/session-user.ts's own
 * comment) — this is purely a web-UI narrowing on top of the one shared
 * backend, not a data migration.
 */
export async function getDesktopModeGate(userId: string): Promise<DesktopModeGate> {
  const rows = await db.exeLicense.findMany({ where: { userId, product: EXE_PRODUCT } });
  const now = new Date();
  const bound = rows.find((l) => l.boundMachineId && keyExpiryIsAfter(l.licenseKey, now));
  if (!bound || !bound.boundMachineId) return UNGATED;

  const exeDeviceId = await getExeDeviceCookie();
  const isThisSessionTheBoundDevice =
    !!exeDeviceId && exeDeviceId.trim().toLowerCase() === bound.boundMachineId.trim().toLowerCase();

  return {
    gated: !isThisSessionTheBoundDevice,
    boundMachineLabel: bound.boundMachineLabel,
    boundMachineId: bound.boundMachineId,
    exeLicenseId: bound.id,
  };
}
