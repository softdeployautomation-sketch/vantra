# Cline Task — VPS Service Controls (Admin Panel)

**Repo**: `/Users/mikeolab/vantra` (Next.js 16.2.9 / React 19 / Tailwind v4 / Prisma + Postgres)
**Scope**: App code only. **All server/infra work is already DONE and verified — do not touch the VPS, systemd, sudoers, or the deploy pipeline.**

---

## Why this exists

The VPS (4 vCPU / 7.8 GB) runs TacticalRMM + MeshCentral + Vantra on one box. Before a hardware upgrade, the admin needs a lever to stop non-critical services on demand to free RAM, plus visibility into what's consuming it. The `/admin101/vps` tab already shows memory/disk/load/processes — this task adds a **Services** section to that same tab.

## Infra already in place (verified live — build against these exact facts)

- Vantra runs as the unprivileged system user **`vantra`** (it used to run as `trmm`, which had `NOPASSWD:ALL`; that has been fixed).
- `/etc/sudoers.d/vantra-services` grants the `vantra` user **exactly 12 commands** and nothing else:
  ```
  /usr/bin/systemctl {start|stop|restart} {meshcentral|celery|celerybeat|daphne}.service
  ```
- **`sudo` is at `/usr/bin/sudo`; `systemctl` is at `/usr/bin/systemctl`.**
- **CRITICAL — unit names MUST be fully qualified with the `.service` suffix.** sudo does exact-argv matching. This was tested live:
  - `sudo -n /usr/bin/systemctl restart celerybeat.service` → **exit 0 (allowed)**
  - `sudo -n /usr/bin/systemctl stop celery` (no suffix) → **exit 1 (DENIED)**
  Passing a bare unit name will fail in production. Always use `"celery.service"`, never `"celery"`.
- **Reading service state needs NO sudo at all** (verified as an unprivileged user). Only start/stop/restart need it. So `listServiceStates()` must NOT use sudo — it can read all 11 units, including the protected ones.
- Verified denied for the `vantra` user: `stop rmm.service`, `stop vantra.service`, `stop nginx.service`, `stop postgresql@18-main.service`, `daemon-reload`, `disable`, `mask`, `/bin/bash -c id`.
- nginx `proxy_read_timeout` is **120s** (safely above our 30s exec timeout) and sets `X-Forwarded-For` correctly.

## The 11 services (all verified `LoadState=loaded` — names are correct as written)

| unit (use verbatim) | label | controllable | ~MB |
|---|---|---|---|
| `meshcentral.service` | MeshCentral | ✅ | 141 |
| `celery.service` | Celery worker (TRMM) | ✅ | 206 |
| `celerybeat.service` | Celery Beat (TRMM scheduler) | ✅ | 141 |
| `daphne.service` | Daphne (TRMM WebSockets) | ✅ | 101 |
| `rmm.service` | TacticalRMM API | ❌ protected | 1027 |
| `vantra.service` | Vantra (this app) | ❌ protected | 87 |
| `nginx.service` | nginx | ❌ protected | 16 |
| `postgresql@18-main.service` | PostgreSQL 18 | ❌ protected | 80 |
| `nats.service` | NATS | ❌ protected | 9 |
| `nats-api.service` | NATS API | ❌ protected | 9 |
| `redis-server.service` | Redis | ❌ protected | 7 |

`rmm.service` is deliberately NOT controllable — stopping it would break TRMM's API, agent check-ins, and Vantra's own device list. Verified: none of the 4 controllable units are a systemd dependency of `rmm`, so stopping them cannot cascade.

---

## 1. New file: `lib/services-control.ts`

Start with `import "server-only";`. Mirror the conventions in **`lib/vps-status.ts`** (read it first): `promisify(execFile)`, fixed argv arrays, **no shell**, no string interpolation.

```ts
export const SERVICE_ACTIONS = ["start", "stop", "restart"] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

/** Argv tokens. MUST byte-match /etc/sudoers.d/vantra-services exactly — keep the ".service" suffix. */
export const CONTROLLABLE_UNITS = [
  "meshcentral.service", "celery.service", "celerybeat.service", "daphne.service",
] as const;
export type ControllableUnit = (typeof CONTROLLABLE_UNITS)[number];

export interface ManagedService {
  unit: string;          // fully-qualified, also systemd's `Id`
  label: string;
  controllable: boolean;
  approxMemMb: number;   // fallback for "frees ~N MB" copy when stopped
  impact: string;        // plain-English consequence, shown in the confirm dialog
}

export interface ServiceState extends Omit<ManagedService, never> {
  activeState: string;   // active | inactive | failed | activating | deactivating
  subState: string;      // running | dead | exited | failed
  loadState: string;     // loaded | not-found | masked
  memMb: number | null;  // null when systemd reports none (normal when stopped)
  unknown: boolean;      // true when no block came back for this unit
}

export const MANAGED_SERVICES: readonly ManagedService[];  // 4 controllable FIRST, then 7 protected
export async function listServiceStates(): Promise<ServiceState[]>;
export async function controlService(unit: string, action: ServiceAction): Promise<void>;
```

### `listServiceStates()`

One subprocess for all 11 units, **no sudo**:
```
/usr/bin/systemctl show <all 11 units> --no-pager -p Id -p LoadState -p ActiveState -p SubState -p MemoryCurrent
```
`{ timeout: 5000 }`.

**Parsing — three traps, all verified live:**
1. Output is **blank-line-separated blocks**: split on `/\r?\n\s*\r?\n/`.
2. **Property order within a block is NOT stable.** Real observed output had `MemoryCurrent=` *before* `Id=`. Build a `Map<Id, Record<string,string>>` and **key off the `Id=` value — never rely on position.** Split each line on the **first** `=` only (`indexOf`/`slice`, not `split("=")`).
3. **`MemoryCurrent` normalisation:** systemd emits `[not set]` for inactive/unaccounted units and some versions emit `18446744073709551615` (UINT64_MAX). Return `null` if the value is `[not set]`, `NaN`, or `>= 2**53`. Skipping this renders `17592186044416 MB` in the UI.

Emit results in `MANAGED_SERVICES` order (not systemctl's) so the table never reshuffles between polls. Units with no returned block get `unknown: true`. If the whole `execFile` rejects → `console.error` and **rethrow** (the route decides the status code).

### `controlService(unit, action)`

```ts
export class ServiceControlError extends Error {
  constructor(readonly code: "not_allowed" | "command_failed" | "timeout",
              message: string, readonly detail?: string) { super(message); this.name = "ServiceControlError"; }
}
```
In order:
1. `const svc = MANAGED_SERVICES.find(s => s.unit === unit && s.controllable);` → if not found, throw `ServiceControlError("not_allowed", "That service can't be controlled from here.")`.
2. Reject if `action` isn't in `SERVICE_ACTIONS`.
3. ```ts
   await execFileAsync("/usr/bin/sudo",
     ["-n", "/usr/bin/systemctl", action, svc.unit],   // svc.unit — the CONSTANT, never the caller's string
     { timeout: 30_000 });
   ```

**Pass `svc.unit` (the table constant), not the caller's `unit` string.** Equality-match then substitute means no caller-controlled text can ever reach argv. `-n` makes sudo fail fast instead of hanging on a prompt.

On `ETIMEDOUT` → throw `code: "timeout"`. On other failures → `code: "command_failed"`, `console.error` the full stderr, and put a **truncated 200-char** stderr in `detail`. If stderr contains `password is required` or `not allowed to execute`, set the message to `"Permission denied — check /etc/sudoers.d/vantra-services."` (this is admin-only UI; surfacing it turns a 40-minute debug into 40 seconds). Log `console.info("[services] action=… unit=… ok")` on success.

### Impact copy (goes in `MANAGED_SERVICES`, rendered in the confirm dialog)

- **MeshCentral** — "Remote control and remote-desktop sessions stop working, and any live session — including your own — disconnects immediately. Agents reconnect on their own once it's started again. TRMM check-ins, alerts and Vantra's device list are unaffected."
- **Celery worker** — "TacticalRMM's background worker. Scheduled tasks, automation policies, alert processing and notification emails all stop running. Queued jobs stay in Redis and resume when it starts again, but jobs in flight are killed. Agent check-ins and the device list keep working."
- **Celery Beat** — "TacticalRMM's scheduler. No new scheduled or recurring tasks are queued while it's stopped, and missed windows are skipped rather than caught up on restart."
- **Daphne** — "TacticalRMM's WebSocket/ASGI server. The TRMM web UI's live-updating panels stop refreshing. Vantra uses the REST API, not Daphne, so it keeps working."

---

## 2. New file: `app/api/admin/services/route.ts` (GET + POST)

**Deliberately a separate endpoint — do NOT fold service state into `/api/admin/vps`.** Reason: `/api/admin/vps` 502s as a unit; folding services in means one systemctl hiccup blanks the Memory bar, Disk bar, Load and Uptime — exactly the readouts the admin is staring at while deciding what to stop. Separate endpoints let the services table degrade on its own.

`export const dynamic = "force-dynamic";`

**GET** — `requireAdminSession()` → 401; then `{ services: await listServiceStates() }`; on throw → `console.error` + 502 `{ error: "Couldn't read service state right now." }`.

**POST** — in this order:
1. `requireAdminSession()` → 401 `{ error: "Not authenticated." }`
2. `allowAndRecord(await getClientIp(), "admin-service-action")` → 429
3. zod parse in try/catch → 400 with `e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body."` (**zod v3 — `e.errors`, not `e.issues`**)
   ```ts
   const actionSchema = z.object({
     unit: z.enum(CONTROLLABLE_UNITS),
     action: z.enum(SERVICE_ACTIONS),
   });
   ```
   `z.enum` (not `z.string()`) is a deliberate **third independent gate** — it rejects `rmm.service` with a clean 400 before any process spawns. (If TS complains about the readonly tuple, use `z.enum([...CONTROLLABLE_UNITS] as [ControllableUnit, ...ControllableUnit[]])`.)
4. `await controlService(parsed.unit, parsed.action)` — map errors: `not_allowed` → 403; `timeout` → **202** `{ ok: true, message: "Command sent but still finishing — the table will update shortly." }`; `command_failed` → 502 `{ error, detail }`.
5. Success → `{ ok: true, message, services: await listServiceStates().catch(() => null) }`.
   Returning the fresh list is worth it: `controlService` blocked until systemd finished, so this read is authoritative and the table updates the instant the toast fires. The `.catch(() => null)` ensures a read failure never turns a successful stop into an error response.

Every admin route self-guards — the `(protected)` layout does **not** cover `app/api/admin/**`.

## 3. `lib/rate-limit.ts`

Add `"admin-service-action"` to the `RateLimitKind` union **and** to the `RULES` record (both are required — it's a closed union with a `Record<RateLimitKind, Rule[]>`):
```ts
"admin-service-action": [
  { limit: 6,  windowMs: 60 * 1000 },
  { limit: 40, windowMs: 60 * 60 * 1000 },
],
```
No Prisma migration needed — `RateLimitEvent.kind` is a plain `String` with an existing composite index. This is a safety valve against double-click/retry storms bouncing celery, not a security control.

---

## 4. `app/admin101/(protected)/vps/page.tsx`

Add a **second, independent** try/catch so a systemctl failure can't null out the metrics:
```tsx
let initial: VpsMetricsView | null = null;
let initialServices: ServiceStateView[] | null = null;
try { initial = { ...(await getVpsMetrics()), generationQueue: getGenerationQueueDepth() }; }
catch (err) { console.error("getVpsMetrics failed:", err); }
try { initialServices = await listServiceStates(); }
catch (err) { console.error("listServiceStates failed:", err); }
```
Pass both to `<AdminVpsClient />`. Extend the subhead with "Stop non-critical services below to free RAM."

## 5. `components/admin/admin-vps-client.tsx` (the bulk of the work)

`lib/services-control.ts` is `server-only`, so — exactly like the existing `VpsMetricsView` — declare and **export** a structural copy `ServiceStateView` in this file.

### Hoist the refresher (currently `refresh()` lives inside the `useEffect`)
```ts
const mounted = useRef(true);
const refreshMetrics  = useCallback(async () => { /* GET /api/admin/vps      */ }, []);
const refreshServices = useCallback(async () => { /* GET /api/admin/services */ }, []);

useEffect(() => {
  mounted.current = true;                       // set INSIDE the effect — React 18 StrictMode
  const id = setInterval(() => {                // double-mounts in dev and would leave it false
    void Promise.allSettled([refreshMetrics(), refreshServices()]);
  }, REFRESH_MS);
  return () => { mounted.current = false; clearInterval(id); };
}, [refreshMetrics, refreshServices]);
```
`Promise.allSettled`, not `all` — a services 502 must not abort the metrics update. Each refresher guards its own `setState` with `if (!mounted.current) return;` and writes only its own error slot (`setError` vs `setServicesError`).

### Render order
1. existing stale-metrics banner → 2. **NEW memory-pressure banner** → 3. Memory/Disk cards → 4. Load/Uptime/Queue cards → 5. **NEW Services section** → 6. Top processes table → 7. auto-refresh note → 8. **NEW single `<ConfirmDialog>`**

### Memory-pressure banner (new, slot 2)
```ts
const MEM_WARN_PERCENT = 80;   // distinct from usageTone()'s 75/90 — that drives bar colour, this drives a call to action
```
Shows at `memUsedPercent >= 80`: amber (`bg-amber-50 text-amber-800`) 80–89, red (`bg-red-50 text-red-700`) at ≥90, `role="status"`. Copy must compute the **live** recoverable figure — sum `memMb ?? approxMemMb` over controllable services that are currently `active` — never a hardcoded number, so it stops promising RAM it can't deliver once things are stopped. Mention that TacticalRMM's API stays up so agents keep checking in.

### Services section (new, slot 5)
Use a **raw `<table className="min-w-full divide-y divide-border text-left text-sm">`** matching the existing "Top processes" table in this file (not the `Table` primitive).

**Columns:** Service | Status | Memory | Actions (right-aligned).
**Row order:** `MANAGED_SERVICES` order — 4 controllable first, then protected (muted name text). No sub-headers.

Status badge: `loadState === "not-found"` → warning "Not installed"; `unknown` → neutral "Unknown"; `active` → success "Running"; `failed` → danger "Failed"; `activating`/`deactivating` → warning; else neutral "Stopped". Show `subState` as small muted text beneath.

Memory cell: `{memMb} MB`, or `—` when null.

Actions cell:
- protected → `<Badge tone="neutral">Protected</Badge>`, no buttons
- controllable + running → `Restart` (secondary) + `Stop` (danger)
- controllable + stopped/failed → `Start` (secondary)
- transitional/unknown → disabled
- `className="px-2.5 py-1.5 text-xs"`; in-flight button shows `<Spinner />` before its label
- **`disabled={pending !== null}` disables EVERY action button while any action is in flight** — concurrent systemctl churn on a memory-constrained box is worth preventing outright

**Required safety feature — persistent stopped-service strip.** Whenever any controllable service is stopped, show an amber strip at the top of the Services section that stays until it's started again (a toast is not enough — it vanishes):
> "Celery worker is stopped. TacticalRMM automation, alerting and notification emails are paused."

This matters because stopping celery breaks TRMM automation **completely silently** — nothing else anywhere would tell you.

Add a footnote under the table: memory here is systemd cgroup usage and **won't match** the RSS figures in the process table above (cgroup includes page cache) — two tables disagreeing otherwise looks like a bug. Also note stops are **not permanent** — anything enabled comes back on reboot.

### ConfirmDialog
**One shared instance** driven by state, not one per row:
```ts
const [confirmTarget, setConfirmTarget] = useState<(ServiceStateView & { action: ServiceAction }) | null>(null);
const [pending, setPending] = useState<string | null>(null);   // `${unit}:${action}`
```
- **`start` skips the dialog entirely** and runs immediately — starting isn't destructive, and reserving the modal for destructive intent keeps it meaningful.
- `stop` and `restart` both use `confirmVariant="danger"` (a celery restart drops in-flight tasks).
- `description` = the service's `impact` string from the API payload (single source of truth), plus: "This frees roughly {memMb ?? approxMemMb} MB. Nothing restarts it automatically — start it again from this page when you're done, or it will come back on the next reboot."
- `confirming={pending !== null}`.

### Action handler
Follow `components/admin/admin-payments-client.tsx` exactly (pending-id state, `await res.json().catch(() => ({}))`, `data.error ?? fallback`, cleanup in `finally`) with **one deliberate difference: do NOT call `router.refresh()`.** That page uses it, but this page's live data comes from client polling — `initial`/`initialServices` only seed `useState` and are ignored on re-render, so `router.refresh()` would re-run the RSC for nothing. Instead, in `finally`:
```ts
setPending(null); setConfirmTarget(null);
void refreshServices();
void refreshMetrics();   // the payoff: the Memory bar visibly drops within a second
```
If the POST response carried `services`, `setServices(data.services)` immediately.

**Extra imports:** `useCallback`, `useRef`; `Button`, `Spinner` from `@/components/ui`; `ConfirmDialog` from `@/components/modal`; `useToast` from `@/components/toast`.

**Do not touch `NAV_ITEMS`** in `admin-shell.tsx` — Services is a section inside the existing VPS tab, not a new route.

---

## Acceptance criteria

1. `npx tsc --noEmit -p .` clean; `npm run build` clean.
2. VPS tab renders all 11 rows in fixed order; running units show "Running" + plausible MB; **no absurd numbers like `17592186044416 MB`**.
3. Protected rows show "Protected" with no buttons.
4. Stop Celery Beat → dialog shows the scheduler impact text and a "frees ~N MB" figure → confirm → success toast, row flips to Stopped, **Memory bar drops without waiting for the 15s poll**, and the persistent amber strip appears. Start again → no dialog, strip disappears.
5. **Negative test (must pass independently of sudoers):** authenticated `POST /api/admin/services` with `{"unit":"rmm.service","action":"stop"}` → **400** from the zod enum, and `rmm` is still active. Same with `{"unit":"vantra.service","action":"stop"}`.
6. POST without an admin cookie → 401. Seven POSTs inside a minute → the 7th returns 429.
7. Kill the network mid-action in devtools → error toast, `pending` clears, buttons re-enable (no stuck spinner).

## Out of scope — do not do these
- Any change to `/etc/sudoers.d/*`, systemd units, the VPS, or the deploy scripts (all done already).
- Adding `disable`/`mask`/`daemon-reload` — deliberately not in the allowlist; they'd be denied anyway.
- Making `rmm.service` controllable.
- Auto-stopping services on a memory threshold — the banner warns, a human decides.
