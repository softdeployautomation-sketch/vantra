"use client";

import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog, Modal } from "@/components/modal";
import { Button, Card, Input, Label, Select, Spinner, Td, Textarea, Th, Table } from "@/components/ui";
import { useToast } from "@/components/toast";

interface ScriptView {
  id: string;
  name: string;
  shell: string;
  description: string | null;
  createdAt: string;
}

export function ScriptManager({ agentId }: { agentId: string }) {
  const toast = useToast();
  const [scripts, setScripts] = useState<ScriptView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [shell, setShell] = useState<"powershell" | "cmd" | "bash">("powershell");
  const [scriptBody, setScriptBody] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [runTarget, setRunTarget] = useState<ScriptView | null>(null);
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/scripts")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setError(null);
        setScripts(d.scripts ?? []);
      })
      .catch(() => setError("Couldn't load scripts."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createScript() {
    setCreateError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, shell, scriptBody, description: description || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(data.error ?? "Couldn't save the script.");
        return;
      }
      setCreateOpen(false);
      setName("");
      setScriptBody("");
      setDescription("");
      setShell("powershell");
      toast.push(`Saved "${name}".`, "success");
      load();
    } catch {
      setCreateError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runScript() {
    if (!runTarget) return;
    setRunning(true);
    setRunOutput(null);
    try {
      const res = await fetch(
        `/api/devices/${encodeURIComponent(agentId)}/scripts/${runTarget.id}/run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunOutput(`Error: ${data.error ?? res.status}`);
        return;
      }
      setRunOutput(String(data.output ?? "(no output)"));
    } catch {
      setRunOutput("Error: network failure.");
    } finally {
      setRunning(false);
      setRunTarget(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">Your scripts</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Write and run your own scripts on this device.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          New script
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Shell</Th>
              <Th>Created</Th>
              <Th className="text-right">Run</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <Td colSpan={4} className="py-8 text-center text-fg-muted">
                  <Spinner className="mr-2" /> Loading…
                </Td>
              </tr>
            ) : scripts.length === 0 ? (
              <tr>
                <Td colSpan={4} className="py-10 text-center text-fg-muted">
                  No scripts yet. Create one to run it on this device.
                </Td>
              </tr>
            ) : (
              scripts.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="font-medium text-fg">{s.name}</div>
                    {s.description && (
                      <div className="text-xs text-fg-muted">{s.description}</div>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{s.shell}</Td>
                  <Td className="text-fg-muted">{new Date(s.createdAt).toLocaleDateString()}</Td>
                  <Td className="text-right">
                    <Button variant="secondary" type="button" onClick={() => setRunTarget(s)}>
                      Run
                    </Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      {runOutput !== null && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Output</h3>
            <Button type="button" variant="ghost" onClick={() => setRunOutput(null)}>
              Dismiss
            </Button>
          </div>
          {/* Terminal look — intentionally theme-independent (not a token retrofiit). */}
          <pre className="max-h-80 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-300">
            {runOutput}
          </pre>
        </Card>
      )}

      {/* New script modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New script" wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createScript();
          }}
          className="space-y-4"
        >
          {createError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</div>
          )}
          <div>
            <Label htmlFor="script-name">Name</Label>
            <Input id="script-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </div>
          <div>
            <Label htmlFor="script-shell">Shell</Label>
            <Select id="script-shell" value={shell} onChange={(e) => setShell(e.target.value as typeof shell)}>
              <option value="powershell">powershell</option>
              <option value="cmd">cmd</option>
              <option value="bash">bash</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="script-body">Script body</Label>
            <Textarea
              id="script-body"
              value={scriptBody}
              onChange={(e) => setScriptBody(e.target.value)}
              rows={8}
              className="font-mono"
              placeholder={'Write-Host "Hello from Vantra"'}
              required
            />
          </div>
          <div>
            <Label htmlFor="script-desc">Description (optional)</Label>
            <Input id="script-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !scriptBody.trim()}>
              {saving && <Spinner />} Save script
            </Button>
          </div>
        </form>
      </Modal>

      {/* Run-this-script confirm */}
      <ConfirmDialog
        open={!!runTarget}
        onClose={() => setRunTarget(null)}
        onConfirm={runScript}
        title={`Run "${runTarget?.name}"?`}
        description={`This executes the script on the selected device. It's your own script, but make sure it's safe to run — this cannot be cancelled once sent.`}
        confirmLabel="Run script"
        confirmVariant="primary"
        confirming={running}
      />
    </div>
  );
}