# Cline Task — "Backstage" Remote Administration Panel

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code only.

## Context

Remote Tools today (`components/remote-tools.tsx`) gives a premium customer MeshCentral iframe access (full remote-desktop GUI) plus a single terminal/run-command panel. The user wants a faster, GUI-free way to do routine admin work on their own devices — start/stop services, kill a process, list/install/uninstall software — **without** clicking through the actual remote desktop. This is a new "Backstage" sub-section living **inside the existing Remote Tools tab**, not a replacement for Mesh/Terminal, which stay exactly as they are.

**TRMM-side facts, verified live against the real deployed API this session (do not re-derive or guess these)**:

- **A Windows "list/control services" REST API does not exist anywhere in TacticalRMM.** Grepped the actual Django source (`agents/`, confirmed no `Service` view class). Services must be implemented via the **existing** raw-command mechanism (`sendRawCmd`, already in `lib/trmm.ts`) running PowerShell — same approach already used for Vantra's own VPS systemd services, just PowerShell instead of systemctl.
- **A process list + kill API already exists and now works**: `GET /agents/{agent_id}/processes/` and `DELETE /agents/{agent_id}/processes/{pid}/`. Confirmed live, real response shape:
  ```json
  [{"name":"smss.exe","pid":296,"membytes":1331200,"username":"NT AUTHORITY\\SYSTEM","id":1,"cpu_percent":"0.0"}]
  ```
- **An installed-software list + Chocolatey-install + uninstall API already exists and now works.** Confirmed live:
  - `PUT /software/{agent_id}/` — triggers a fresh scan on the agent, returns the string `"ok"`. Must be called before the first `GET` ever returns real data (otherwise `GET` returns `[]`).
  - `GET /software/{agent_id}/` — returns `{ "id": <int>, "software": [ { "name", "size", "source", "version", "location", "publisher", "uninstall", "install_date" } ] }` (or `[]` if never scanned).
  - `POST /software/{agent_id}/` with `{ "name": "<choco package name>" }` — installs via Chocolatey. Windows-only (`notify_error` if the agent is POSIX).
  - `POST /software/{agent_id}/uninstall/` with `{ "name", "command", "timeout", "run_as_user" }` — `command` is literally the `uninstall` string from the software list above, executed via a raw `cmd` shell. **TRMM itself already refuses to uninstall the TacticalAgent through this endpoint** (checks for `"tacticalagent"` + `"unins"` substrings in the command and 400s) — don't duplicate that guard, it's server-side already.
- **`can_send_cmd` was `False` on the `vantra-service` TRMM role until this session** — meaning the *existing* Terminal panel in Remote Tools has likely never actually worked in production (it would have 403'd on every real attempt). This has been fixed server-side (permission granted and live-verified with a real command against a real agent). **No app-code change is needed for this specific fix** — flagging it here only so it isn't mistaken for a new bug if the Terminal panel suddenly starts working differently than before.
- **Required TRMM permissions for this task**: `can_manage_procs`, `can_list_software`, `can_manage_software` — **all three already granted and live-verified this session.** Nothing further needed on the TRMM side before building this.
- **PowerShell service listing, confirmed live** with real output:
  ```powershell
  Get-Service | Select-Object Name,DisplayName,@{n="Status";e={$_.Status.ToString()}},@{n="StartType";e={$_.StartType.ToString()}} | ConvertTo-Json -Compress
  ```
  Returns a JSON-encoded **string** (TRMM's `cmd` endpoint always returns a plain string) containing a JSON array — e.g. `"[{\"Name\":\"ADWS\",\"DisplayName\":\"...\",\"Status\":\"Stopped\",\"StartType\":\"Disabled\"}, ...]"`. Must `JSON.parse()` the string once. **Important quirk to guard against**: PowerShell's `ConvertTo-Json` emits a single JSON **object** (not wrapped in an array) if the pipeline only produces one item — always check `Array.isArray(parsed)` and wrap in `[parsed]` if not, exactly like the existing `AgentDetail`/checks-handling code elsewhere in this codebase already does for similar single-vs-array quirks.
  Status/StartType come back as the human-readable strings already (`"Running"`, `"Stopped"`, `"Automatic"`, `"Manual"`, `"Disabled"`) — **do not** attempt to map raw numeric enum values; the `.ToString()` calls in the command above already handle that.
- **PowerShell service control, confirmed live**:
  ```powershell
  Restart-Service -Name "Spooler" -Force; if ($?) { Write-Output "OK" } else { Write-Output "FAILED" }
  ```
  Real output on success: `"WARNING: Waiting for service 'Print Spooler (Spooler)' to start...\nOK\r\n"`. Treat any response containing the literal substring `"OK"` as success (the warning/status noise before it is normal and harmless), and anything containing `"FAILED"` as failure. Use `Start-Service`/`Stop-Service`/`Restart-Service` for the three actions.
- **Sanitize the service name before building the PowerShell string.** It should always come from a value just returned by the list call, but as defense in depth: reject any service name containing `"`, `` ` ``, `$`, or `;` before interpolating it into the command string (a customer already has full terminal access to their own device via the existing Terminal panel, so this isn't closing a privilege-escalation hole — it's just not building fragile/breakable PowerShell strings).

## 1. `lib/trmm.ts` additions

```ts
// --- Task Manager (processes) ---
export interface AgentProcess {
  name: string;
  pid: number;
  membytes: number;
  username: string;
  id: number;
  cpu_percent: string;
}
export const listAgentProcesses = (agentId: string) =>
  trmm<AgentProcess[]>(`/agents/${agentId}/processes/`);
export const killAgentProcess = (agentId: string, pid: number) =>
  trmm<string>(`/agents/${agentId}/processes/${pid}/`, { method: "DELETE" });

// --- Apps (installed software) ---
export interface InstalledSoftwareItem {
  name: string;
  size: string;
  source: string;
  version: string;
  location: string;
  publisher: string;
  uninstall: string; // the literal command needed to uninstall — pass straight back to uninstallSoftware
  install_date: string;
}
export const refreshInstalledSoftware = (agentId: string) =>
  trmm<string>(`/software/${agentId}/`, { method: "PUT" }); // triggers a rescan; returns "ok"
export async function getInstalledSoftware(agentId: string): Promise<InstalledSoftwareItem[]> {
  const res = await trmm<{ software: InstalledSoftwareItem[] } | []>(`/software/${agentId}/`);
  return Array.isArray(res) ? [] : res.software;
}
export const installSoftwareViaChoco = (agentId: string, name: string) =>
  trmm<string>(`/software/${agentId}/`, { method: "POST", body: JSON.stringify({ name }) });
export const uninstallSoftware = (
  agentId: string,
  opts: { name: string; command: string; timeout: number; runAsUser?: boolean },
) =>
  trmm<string>(`/software/${agentId}/uninstall/`, {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      command: opts.command,
      timeout: opts.timeout,
      run_as_user: opts.runAsUser ?? false,
    }),
  });

// --- Windows services (no dedicated TRMM API — built on the existing raw-cmd mechanism) ---
export interface WindowsServiceInfo {
  name: string;
  displayName: string;
  status: string; // "Running" | "Stopped" | "Paused" | ... (already human-readable, see above)
  startType: string; // "Automatic" | "Manual" | "Disabled" | ...
}
const UNSAFE_SERVICE_NAME = /["`$;]/;

export async function listWindowsServices(agentId: string): Promise<WindowsServiceInfo[]> {
  const raw = await sendRawCmd({
    agentId,
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
    cmd: 'Get-Service | Select-Object Name,DisplayName,@{n="Status";e={$_.Status.ToString()}},@{n="StartType";e={$_.StartType.ToString()}} | ConvertTo-Json -Compress',
  });
  const parsed: unknown = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return (arr as Array<Record<string, string>>).map((s) => ({
    name: s.Name,
    displayName: s.DisplayName,
    status: s.Status,
    startType: s.StartType,
  }));
}

export async function controlWindowsService(
  agentId: string,
  serviceName: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  if (UNSAFE_SERVICE_NAME.test(serviceName)) {
    throw new Error("Invalid service name.");
  }
  const verb =
    action === "start" ? "Start-Service" : action === "stop" ? "Stop-Service" : "Restart-Service";
  const result = await sendRawCmd({
    agentId,
    shell: "powershell",
    timeout: 30,
    runAsUser: false,
    cmd: `${verb} -Name "${serviceName}" -Force; if ($?) { Write-Output "OK" } else { Write-Output "FAILED" }`,
  });
  if (!result.includes("OK")) {
    throw new Error(`Failed to ${action} ${serviceName}.`);
  }
}
```

## 2. New API routes — all gated by `authorizePremiumAgentAction` (the SAME guard already used by `mesh`/`cmd`/`maintenance-overlay`, in `lib/agent-route.ts`)

No new authorization helper needed — this is a straight extension of the existing Remote Tools premium-plan-plus-ownership gate, never staff-bypassed, exactly like every other Remote Tools route.

- `app/api/devices/[agentId]/processes/route.ts` — `GET` → `listAgentProcesses`.
- `app/api/devices/[agentId]/processes/[pid]/route.ts` — `DELETE` → `killAgentProcess`. Validate `pid` is a positive integer before calling (zod or a plain `Number.isInteger` guard) — reject non-numeric path segments with 400 rather than forwarding garbage to TRMM.
- `app/api/devices/[agentId]/software/route.ts` — `GET` → `getInstalledSoftware`; `PUT` → `refreshInstalledSoftware`; `POST` (`{ name }`, zod-validated non-empty string) → `installSoftwareViaChoco`.
- `app/api/devices/[agentId]/software/uninstall/route.ts` — `POST` body `{ name, command, timeout, runAsUser? }` (zod: `name`/`command` non-empty strings, `timeout` a positive int capped at 90 to match the existing Terminal panel's convention, `runAsUser` optional boolean) → `uninstallSoftware`.
- `app/api/devices/[agentId]/services/route.ts` — `GET` → `listWindowsServices`.
- `app/api/devices/[agentId]/services/[serviceName]/route.ts` — `POST` body `{ action: "start" | "stop" | "restart" }` (zod enum) → `controlWindowsService`. Catch the thrown `Error` from an invalid service name and return 400, not a 500.

Every route: `try { ... } catch (err) { console.error(...); return NextResponse.json({ error: "..." }, { status: 502 }); }`, matching the error-handling convention already used by every other `/api/devices/[agentId]/*` route.

## 3. UI — extend `components/agent-detail-client.tsx` + `components/remote-tools.tsx`

Add a **new sub-tab labeled "Backstage"** inside the existing Remote Tools section, using the existing `components/tabs.tsx` primitive (already used elsewhere for tab switching, e.g. Overview/Scripts/Remote Tools on the device page itself — reuse the same component, don't build a second one). Backstage's own internal tabs: **Terminal | Services | Processes | Apps**.

- **Terminal**: literally the existing run-command panel from `remote-tools.tsx`, unchanged — just relocated to live under this new Backstage grouping instead of being its own top-level section. Do not modify its logic.
- **Services** (new): a table (Name / Display Name / Status `Badge` / Start Type / Actions). Fetch via `GET .../services` on tab-open (not on every render — cache in state, add a manual "Refresh" button, since listing all ~200 Windows services takes a few seconds over the agent's NATS round-trip). Actions per row: Start (if stopped), Stop + Restart (if running) — each behind the existing `ConfirmDialog` component (reuse exactly as done for reboot/shutdown elsewhere in this codebase), since stopping the wrong service on someone's PC is a real "oops." A search/filter `Input` above the table (client-side, ~200 rows) since there's no server-side search need here.
- **Processes** (new): a table (Name / PID / User / Mem (format `membytes` as MB) / CPU% / Actions). "End process" button per row behind `ConfirmDialog`. Auto-refresh isn't necessary (task manager snapshots are fine on-demand) — same manual-refresh pattern as Services.
- **Apps** (new): a table listing installed software (Name / Version / Publisher / Size / Actions). On first open, if the list is empty, show a "Scan for installed software" button (calls `PUT`) before showing the table. "Uninstall" button per row (reads that row's own `uninstall` string, calls the uninstall route with it) behind `ConfirmDialog` with the software name in the confirmation text. A small "Install package" form (Chocolatey package name `Input` + button) at the top — label it clearly as **"Install via Chocolatey (package name must match exactly, e.g. `googlechrome`, `7zip`)"** since this is a real gap from a plain name to a real package and a wrong name just fails cleanly, it doesn't need elaborate validation.

**Gating reminder**: this entire Backstage section only ever renders for `plan === "premium"` + ownership — reuse whatever conditional already wraps the rest of Remote Tools in `agent-detail-client.tsx` (do not add a second, separate gate).

## Verification

1. Confirm Backstage only appears for premium accounts on their own devices (non-premium sees the existing `RemoteToolsLocked` upsell exactly as today; premium on someone else's device still gets blocked by ownership, matching every other Remote Tools route).
2. Live-test each of the four sub-tabs against a real connected agent: list services and toggle one non-critical service off and back on; list processes; open Apps, scan, confirm real software appears, uninstall something genuinely harmless and confirm it's actually gone after a re-scan.
3. Confirm the "OK"/"FAILED" substring check in `controlWindowsService` correctly reports failure for a nonexistent service name, and confirm the unsafe-character guard rejects a service name containing a quote.
4. Confirm a `DELETE` on `/processes/{pid}/` with a non-numeric `pid` returns 400, not a crash.
5. Regression: confirm the existing Terminal panel (now relocated under Backstage) still works exactly as before — this is the first real end-to-end proof that the `can_send_cmd` permission fix actually took effect in the live UI, not just via direct API testing.
