# Cline Task — Device Right-Click Context Menu (Control, Delete/Uninstall)

**Repo**: `/Users/mikeolab/vantra`. **Depends on**: `CLINE_TASK_DEVICE_UI_AND_GROUPS.md` (the redesigned device list this menu attaches to) — do this task after or alongside that one, since it needs the new row layout to exist.

## Context

The user asked for a right-click menu on each device row with: Control, "run control with my input suspended," and delete/uninstall the device. Two of these needed live verification against the real TRMM/MeshCentral source before writing any spec — both are reported honestly below, one confirmed real, one confirmed **not available**.

### Finding 1 — "Delete the device" and "uninstall the agent" are the same single TRMM operation

Read the actual view class (`agents/views.py`, `GetUpdateDeleteAgent.delete`). There is no separate "just remove the device record" vs. "uninstall the software" distinction in TRMM — **one call does both**:
```python
def delete(self, request, agent_id):
    agent = get_object_or_404(Agent, agent_id=agent_id)
    ...
    asyncio.run(agent.nats_cmd({"func": "uninstall", "code": code}, wait=False))  # tells the live agent to uninstall itself
    agent.delete()          # removes the TRMM database record UNCONDITIONALLY, even if the agent is offline/unreachable
    ...
    asyncio.run(remove_mesh_agent(uri, mesh_id))   # cleans up the MeshCentral node too
    return Response(f"{name} will now be uninstalled.")
```
So `DELETE /agents/{agent_id}/` is genuinely one irreversible action: it fires the uninstall command at the live agent (best-effort, fire-and-forget — doesn't wait for or require the agent to actually respond) and deletes the TRMM/Vantra-visible record regardless. There is nothing to build for "delete the device record only" as a separate, softer action — it doesn't exist in TRMM, and there's no reasonable way to fake it (an orphaned agent record with a dead uninstall command pending would be worse than either real option).

**Required TRMM permission**: `can_uninstall_agents` (a distinct permission from `can_edit_agent`, which only gates the PUT/rename path on the same endpoint). **Already granted to the `vantra-service` role this session and confirmed applied** — nothing further needed on the TRMM side.

### Finding 2 — MeshCentral has no "suspend the remote user's local input" toggle

Searched the actual deployed MeshCentral's agent-based KVM viewer script (`agent-desktop-0.0.2.js`) for any input-blocking capability (privacy mode, block-input toggle, exclusive-control flag) under every naming convention a feature like this would plausibly use. **Found nothing.** This MeshCentral setup's Windows-agent KVM connection has no built-in way to let an admin control the mouse/keyboard while denying the local user's own input.

**Do not build a fake version of this** (e.g. a checkbox that silently does nothing) — it would be a lie in the UI. Two honest options, pick one when you get to this:
1. **Skip it entirely.** The context menu's "Control" item just opens the existing Mesh control iframe, same as today — the local user's real screen/input remain exactly as MeshCentral already handles them (no change from current behavior).
2. **Pair it with the maintenance overlay that's already built** (`components/remote-tools.tsx`'s "Start/Stop maintenance overlay" — a full-screen fake Windows Update screen). This doesn't block input at the OS level, it just visually covers the real screen with something the local user won't try to interact with. Offer a context-menu item **"Control (with maintenance screen)"** that calls `POST .../maintenance-overlay {action:"start"}` first, then opens the Control tab, and reminds the admin to stop the overlay when done. This was explicitly already documented as **not true input-blocking** when it was built (no low-level Windows hook — that's a real compiled-driver-level feature, out of scope here same as it was before) — keep that same honest framing in whatever UI copy accompanies it.

Recommend option 2 to the user as the closest real thing to what they asked for, but implement whichever they confirm.

## 1. New API route

`app/api/devices/[agentId]/route.ts` likely already exists for `GET` (agent detail) — if so, **add** a `DELETE` handler to it rather than creating a new file (check first). Gate it with the same ownership-checking pattern already used for `reboot`/`shutdown` (`authorizeAgentAction` — staff bypass + ownership, **not** premium-gated; deleting your own broken/decommissioned device is basic device management, not a Remote Tools feature, so don't require `plan === "premium"` for this).

```ts
export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const authz = await authorizeAgentAction(agentId); // existing helper — reuse, don't reinvent
  if (!authz.ok) return authz.response;

  try {
    await deleteAgent(agentId); // new lib/trmm.ts function, see below
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteAgent failed:", err);
    return NextResponse.json({ error: "Couldn't delete this device right now." }, { status: 502 });
  }
}
```

Add to `lib/trmm.ts`:
```ts
export const deleteAgent = (agentId: string) =>
  trmm<string>(`/agents/${agentId}/`, { method: "DELETE" });
```

## 2. UI — right-click context menu

There is no existing context-menu primitive in this codebase (confirmed — `components/ui.tsx` has no `Menu`/`Dropdown`/`ContextMenu` export). Build a small, purpose-built one rather than pulling in a UI library for one feature: a `components/device-context-menu.tsx` that renders a fixed-position `div` (styled to match `Card`'s existing border/shadow tokens) at the cursor's `clientX`/`clientY` on `onContextMenu` (call `e.preventDefault()` to suppress the native browser menu), closing on outside-click or `Escape`.

Menu items, in order:
1. **Control** — opens the existing Mesh control URL (same one already used by the device detail page's Remote Tools Control tab) in a new tab, or navigates to the device detail page with the Remote Tools/Control tab pre-selected (prefer whichever the existing detail page already supports via a query param or tab state — check `app/dashboard/devices/[agentId]/page.tsx` for an existing `?tab=` pattern before inventing a new one).
2. **Terminal** — same idea, opens straight to the Terminal tab.
3. *(if the user picks option 2 from Finding 2 above)* **Control (with maintenance screen)** — starts the maintenance overlay, then opens Control.
4. A visual separator.
5. **Delete device** (styled in red/danger text, matching `Badge tone="danger"`'s color) — opens a `ConfirmDialog` with `confirmVariant="danger"`, and **this one specific action should require typing the device's hostname to confirm** (a plain "one-tap yes" `ConfirmDialog` isn't strong enough for an action that's simultaneously "remove a customer's monitored device" and "tell their PC to uninstall software off itself" in one irreversible call) — add a small `Input` inside the dialog's `description` area that must exactly match `device.hostname` before the confirm button enables. On confirm, `DELETE /api/devices/{agentId}`, then remove the device from local list state (and from any `DeviceGroupMember` rows referencing it, if the Device Groups task has landed — the group-membership rows become orphaned pointers to a dead `agent_id` otherwise; either cascade-delete them from a webhook-free client-side cleanup call, or simply leave them and have the groups UI silently skip agent_ids that no longer appear in the live `listAgents()` result, which is simpler and requires no extra route).

Wire this into the device list from `CLINE_TASK_DEVICE_UI_AND_GROUPS.md` by attaching `onContextMenu` to each device row.

## Verification

1. Right-click a device row, confirm the menu appears at the cursor and closes on outside-click/Escape.
2. Confirm "Delete device" requires typing the exact hostname before the button enables, and that a typo does not enable it.
3. **Do this step deliberately with the user watching, on a real but genuinely disposable test agent** — this is a real, irreversible destructive action (matches the same "don't silently fire destructive actions during planning" discipline already used for reboot/shutdown/maintenance-overlay in this codebase). Confirm the device disappears from Vantra's list, and confirm in TRMM's own admin/API that the agent record is actually gone.
4. Confirm a non-owner (or non-staff customer on someone else's device) gets 404 from the DELETE route, not 200.
5. If option 2 from Finding 2 was chosen: confirm starting the maintenance overlay then opening Control actually shows the overlay on the real test VM's screen (this exact combination has not been live-tested yet in this project).
