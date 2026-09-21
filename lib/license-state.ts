import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";

// Task 44.2 — local, per-machine persistence for the Vantra EXE's licensing.
// Holds (a) when the 24-hour unlicensed trial started, and (b) once the user
// activates — which license key + email are bound to THIS machine. This is the
// "same tier of tamper-resistance as the rest of the scheme": a determined user
// can edit the file and reset the timer, an accepted, known limitation of
// client-side-only licensing, not something to over-engineer around.

export const TRIAL_HOURS = 24;

export interface ExeLicenseActivation {
  /** Email the buyer entered at activation (checked against `licensee`). */
  licensee: string;
  /** The signed license key. */
  licenseKey: string;
  /** Hardware ID this license was first activated on. */
  machineId: string;
  /** ISO (UTC) timestamp of activation. */
  activatedAt: string;
}

export interface ExeLicenseLocalState {
  version: 1;
  /** ISO (UTC) timestamp of first launch (trial start). Absent pre-first-run. */
  trialStartedAt?: string;
  // Task 69, scope 1 — the account email the server-side trial belongs to
  // (set by the first-launch account screen when it creates/logs-in via
  // POST /api/exe-trial/start). Lets status reconcile the local cached
  // window against the server authority without any session.
  trialEmail?: string;
  /** Present once the user has activated a valid key on this machine. */
  activation?: ExeLicenseActivation;
}

const DEFAULT_STATE: ExeLicenseLocalState = { version: 1 };

/**
 * Resolves where this machine's license state lives. Honours an explicit
 * VANTRA_LOCAL_DATA_DIR override (the Tauri shell can point at its own
 * app-data dir), otherwise falls back to a per-OS app-data location.
 */
export function licenseStatePath(): string {
  const override = process.env.VANTRA_LOCAL_DATA_DIR;
  if (override) return path.join(override, "exe-license-state.json");

  const sys = process.platform; // win32 | darwin | linux | ...
  try {
    if (sys === "win32") {
      return path.join(
        process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
        "Vantra",
        "exe-license-state.json",
      );
    }
    if (sys === "darwin") {
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        "Vantra",
        "exe-license-state.json",
      );
    }
    const dataHome = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
    return path.join(dataHome, "vantra", "exe-license-state.json");
  } catch {
    return path.join(process.env.TMPDIR ?? "/tmp", "vantra", "exe-license-state.json");
  }
}

/** Reads the local state, returning defaults (never throwing) if absent/corrupt. */
export async function readLocalState(): Promise<ExeLicenseLocalState> {
  try {
    const raw = await readFile(licenseStatePath(), "utf8");
    const parsed = JSON.parse(raw) as ExeLicenseLocalState;
    if (parsed && typeof parsed === "object" && parsed.version === 1) return parsed;
  } catch {
    // missing file / bad JSON → defaults
  }
  return { ...DEFAULT_STATE };
}

async function writeLocalState(state: ExeLicenseLocalState): Promise<void> {
  const filePath = licenseStatePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Starts the 24h trial on first launch. No-op (and idempotent) once started —
 * the first launch time is persisted, never reset by re-opening the app.
 */
export async function startTrialIfNeeded(now?: Date): Promise<ExeLicenseLocalState> {
  const state = await readLocalState();
  if (state.activation) return state; // never start a trial behind a valid license
  if (!state.trialStartedAt) {
    state.trialStartedAt = (now ?? new Date()).toISOString();
    await writeLocalState(state);
  }
  return state;
}

/** True while the (started) trial still has time remaining. */
export function trialActive(state: ExeLicenseLocalState, now?: Date): boolean {
  if (!state.trialStartedAt) return false;
  const started = new Date(state.trialStartedAt);
  const current = now ?? new Date();
  return current.getTime() - started.getTime() < TRIAL_HOURS * 60 * 60 * 1000;
}

/** Hours of trial remaining (positive while active). */
export function trialHoursLeft(state: ExeLicenseLocalState, now?: Date): number {
  if (!state.trialStartedAt) return 0;
  const started = new Date(state.trialStartedAt);
  const current = now ?? new Date();
  return Math.max(0, TRIAL_HOURS * 60 * 60 * 1000 - (current.getTime() - started.getTime())) /
    (60 * 60 * 1000);
}

/** Binds an activated license to this machine and persists it. */
export async function saveActivation(
  input: { licensee: string; licenseKey: string; machineId: string },
  now?: Date,
): Promise<ExeLicenseLocalState> {
  const state = await readLocalState();
  state.activation = {
    licensee: input.licensee,
    licenseKey: input.licenseKey,
    machineId: input.machineId,
    activatedAt: (now ?? new Date()).toISOString(),
  };
  await writeLocalState(state);
  return state;
}

/** Removes any stored activation (e.g. a license that expired). */
export async function clearActivation(): Promise<ExeLicenseLocalState> {
  const state = await readLocalState();
  delete state.activation;
  await writeLocalState(state);
  return state;
}

/**
 * Task 69, scope 1 — records which account the server-side trial belongs to
 * (called by the first-launch account screen after POST /api/exe-trial/start
 * succeeds). Never touches trialStartedAt: the local cached window stays as
 * first-launch recorded it; status reconciles it against the server row.
 */
export async function saveTrialEmail(email: string): Promise<ExeLicenseLocalState> {
  const state = await readLocalState();
  state.trialEmail = email.trim().toLowerCase();
  await writeLocalState(state);
  return state;
}