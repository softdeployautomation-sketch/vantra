import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { createDeviceSite } from "@/lib/devices";
import { env } from "@/lib/env";
import { callMsiGenerator } from "@/lib/msi-generator";
import { createDeployment, createManualInstaller, deployUrl } from "@/lib/trmm";
import { getCurrentUser } from "@/lib/session-user";

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
  installMethod: z.enum(["merged", "separated", "msi"]).default("merged"),
});

const MAX_PDF_BYTES = 20 * 1024 * 1024; // ≤20MB

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
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });
  }

  // Retry provisioning here if the client/site ids are still null (per plan).
  const clientId = user.trmmClientId;
  if (!clientId || !user.trmmSiteId) {
    return NextResponse.json(
      { error: "Your account isn't fully set up yet. Please try again in a moment." },
      { status: 409 },
    );
  }

  // Branch on Content-Type: JSON (merged/separated) vs multipart/form-data (msi,
  // which carries an uploaded PDF file).
  let parsed;
  let pdf: File | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const installMethod =
        (form.get("installMethod") as string | null) ?? "merged";
      // msi REQUIRES a PDF; the other two don't carry one.
      if (installMethod === "msi") {
        const file = form.get("pdf");
        if (file instanceof File) pdf = file;
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
  // one. Count non-expired Deployments for this user.
  const maxDevices =
    user.plan === "premium" ? env.maxDevicesPremiumTier : env.maxDevicesFreeTier;
  const activeDeployments = await db.deployment.count({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
  });
  if (activeDeployments >= maxDevices) {
    return NextResponse.json(
      { error: `You've reached the limit of ${maxDevices} active installation files for your plan.` },
      { status: 403 },
    );
  }

  // MSI path: validate the PDF before doing any TRMM work, and screen for the
  // generator not being configured first so we never attempt bad calls.
  if (parsed.installMethod === "msi") {
    if (!env.msiGeneratorUrl) {
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
  }

  // Each device gets its own freshly-created TRMM Site, named by the customer
  // (same for all three methods — the MSI option still needs its own site).
  let siteId: number;
  try {
    siteId = await createDeviceSite(clientId, parsed.deviceName);
  } catch (err) {
    console.error("createDeviceSite failed:", err);
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
      const uid = await createDeployment({
        site: siteId,
        expiresAt,
        agentType: parsed.agentType,
        goarch: parsed.goarch,
      });
      await db.deployment.create({
        data: { ...common, userId: user.id, trmmDeploymentUid: uid },
      });
      result = {
        installMethod: "merged" as const,
        downloadUrl: deployUrl(uid),
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
      });
      await db.deployment.create({
        data: { ...common, userId: user.id, trmmDeploymentUid: null },
      });
      result = {
        installMethod: "separated" as const,
        downloadUrl: null,
        command: manual.cmd,
        installerUrl: manual.url,
      };
    } else {
      // msi — the deployment's uid is the auth token the generator needs.
      const uid = await createDeployment({
        site: siteId,
        expiresAt,
        agentType: parsed.agentType,
        goarch: parsed.goarch,
      });
      let msiReady = false;
      try {
        const msi = await callMsiGenerator({
          clientId,
          siteId,
          agentType: parsed.agentType,
          authToken: uid,
          apiUrl: env.trmmApiBaseUrl,
          pdf: pdf!,
        });
        msiReady = true;
        result = {
          installMethod: "msi" as const,
          downloadUrl: msi.downloadUrl,
          command: null,
          installerUrl: null,
        };
      } catch (err) {
        console.error("callMsiGenerator failed:", err);
        // Per spec: the underlying TRMM Deployment/Site are NOT rolled back
        // (can't be cleanly un-created). Store the row with msiReady:false so the
        // failure is observable, then surface the packaging error.
        await db.deployment.create({
          data: {
            ...common,
            userId: user.id,
            trmmDeploymentUid: uid,
            msiReady,
          },
        });
        return NextResponse.json(
          { error: "Installer was created but packaging failed. Please try again." },
          { status: 502 },
        );
      }
      await db.deployment.create({
        data: { ...common, userId: user.id, trmmDeploymentUid: uid, msiReady },
      });
    }
  } catch (err) {
    console.error("install generation failed:", err);
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
