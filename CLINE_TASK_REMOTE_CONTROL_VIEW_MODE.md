# Cline Task — Remote Control View/Control Toggle (REVISED — Part A only)

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code only.

## Status

Parts B (maintenance overlay menu) and C (multi-tab sessions) from the original version of this task are **done and deployed** — leave them as they are, don't touch `openControlInNewTab`, the overlay start/stop toolbar, or the ConfirmDialogs already wired up in `components/remote-tools.tsx`.

**Part A (view-only default with a toggle to full control) was not built** in the first pass, for a real reason discovered afterward: it is **not** the simple URL-parameter toggle the original task spec assumed. This revision replaces Part A with the actual, source-verified mechanics of how TacticalRMM and MeshCentral generate and handle these sessions on this specific deployment, so this doesn't need rediscovering.

## What was actually verified (read directly from the deployed source on the VPS, not guessed)

- **MeshCentral version on this box: 1.2.4** (`/meshcentral/package.json`).
- **TRMM builds the control URL itself** — `lib/trmm.ts`'s `getMeshCentralUrls` just calls TRMM's `GET /agents/{agentId}/meshcentral/`, which is `agents/views.py`'s `AgentMeshCentral.get()`. The exact URL it returns for the Control tab:
  ```
  {mesh_site}/?login={token}&gotonode={mesh_node_id}&viewmode=11&hide=31
  ```
  `token` comes from `get_login_token(key=core.mesh_token, user=user)` — a MeshCentral login token for either the synced TRMM user or `core.mesh_api_superuser`, generated fresh per request. **There is no `viewonly` parameter anywhere in this URL, and it isn't optional/addable on a whim** — TRMM's Django view doesn't accept one and doesn't pass one through today.
- **MeshCentral's own frontend does not read a `viewonly` query-string parameter at all** — grepped every `.htm`/`.js` file under `/meshcentral/node_modules/meshcentral/views` and `/public/scripts` for `viewonly`, zero matches outside minified bundles (which are the same code, just compressed). Appending `&viewonly=1` to the existing control URL **does nothing** — don't ship that as a "fix," it would silently fail to restrict input.
- **Real view-only enforcement in MeshCentral 1.2.4 is rights-based**, confirmed in `apprelays.js`:
  ```js
  if ((rights != MESHRIGHT_ADMIN) && ((rights & MESHRIGHT_REMOTEVIEWONLY) != 0)) { obj.viewonly = true; }
  ```
  This is a **permission bit on the connecting user/device-group** (`MESHRIGHT_REMOTEVIEWONLY`), checked when the relay session starts — not a per-URL, per-click toggle. To make a *specific* session view-only, the user/token used for that session would need that right set *for that session specifically*, which the current single-shared-superuser-token approach (`core.mesh_api_superuser`, generated fresh per request but always the same MeshCentral account) doesn't naturally support without either (a) toggling that account's rights globally right before generating the URL and back after (racy, and affects every concurrent session using that account), or (b) a different mechanism entirely — see below.
- **The cleaner alternative mechanism that does exist**: MeshCentral supports **device share links** (`meshctrl.js`'s `createDeviceShareLink`, `viewOnly: true` is a first-class option there) — a genuinely separate, purpose-built guest-access URL distinct from the normal technician control URL, meant exactly for "give someone temporary, possibly-view-only access to this device." This is a real MeshCentral server-side API call (over its own websocket/API protocol, using MeshCentral's *own* auth, not TRMM's), which Vantra does **not** currently talk to directly — today Vantra only ever goes through TRMM's `/agents/{id}/meshcentral/` endpoint and never calls MeshCentral's API itself.

## The actual decision needed before writing code (this is a real design fork, not a small thing)

**Option 1 — Direct MeshCentral API integration for share links.** Vantra would need its own MeshCentral API credentials/session (separate from TRMM's), call `createDeviceShareLink` with `viewOnly: true` to mint a genuinely view-only guest URL for the session, and a second call (or the existing `control` URL) for full control. Toggling in the UI swaps which URL the iframe loads. This is real new infrastructure (a MeshCentral API client, credential storage, mapping a TRMM `agent_id`/`mesh_node_id` to a MeshCentral node — check whether TRMM's response already exposes enough to address the same node via MeshCentral's own API, e.g. `agent.mesh_node_id` is already visible server-side in TRMM's view above, worth confirming it's accessible to Vantra too).

**Option 2 — Toggle the shared account's rights around the token request.** Simpler to build, but racy and affects every concurrent Remote Tools session on the box if two technicians are using it at once (since `core.mesh_api_superuser` is one shared account) — **not recommended**, flagging so it isn't picked by accident for being "less code."

**Option 3 — Punt on true input-blocking, ship a soft/UI-only guard instead.** Add a client-side "Arm full control" confirmation step (the iframe stays loaded either way, but a transparent overlay with a "Click to enable input" button sits over it until the technician deliberately clicks through) — this does **not** actually stop input at the protocol level the way MeshCentral's real view-only right does, so a technician who clicks through has full control regardless of "mode," but it does add a deliberate extra step before any accidental input reaches the real device, which may satisfy the actual underlying concern (accidental clicks) without needing new MeshCentral API integration at all.

**Do not silently pick one of these — before writing code, confirm with the user which tradeoff they want**: Option 1 is the only one that provides genuine input-blocking, but is real new integration work (a MeshCentral API client Vantra doesn't have today); Option 3 is a same-day UI change with a materially weaker guarantee (deters accidental clicks, doesn't prevent deliberate ones). Recommend presenting this exact fork to the user rather than assuming.

## Option 1 credentials — RESOLVED, ready to build against (do not rediscover)

Vantra had no MeshCentral credential of its own — confirmed by checking its `.env`/codebase before this answer was written. That gap is now closed:

**The mechanism**: TRMM itself doesn't call MeshCentral's REST/websocket API to build the `control`/`terminal`/`file` URLs — it locally constructs a MeshCentral-compatible login-cookie token using a shared secret, via a small PyPI package called `meshctrl` (confusingly, a *different* thing from the Node.js `meshctrl.js` CLI shipped inside the MeshCentral install itself — don't conflate the two when searching). Read directly from `/rmm/api/env/lib/python3.12/site-packages/meshctrl/utils.py` on the VPS:

```python
def get_login_token(key, user, action=3):
    key = bytes.fromhex(key)
    key1 = key[0:48]
    key2 = key[48:]
    msg = '{{"a":{}, "u":"{}","time":{}}}'.format(action, user.lower(), int(time.time()))
    iv = get_random_bytes(16)
    h = SHA3_384.new(); h.update(key1)
    hashed_msg = h.digest() + msg.encode()
    cipher = AES.new(key2, AES.MODE_CBC, iv)
    msg = cipher.encrypt(pad(hashed_msg, 16))
    return base64.b64encode(iv + msg, altchars=b"@$").decode("utf-8")
```
i.e.: split a shared hex key into a 48-byte SHA3-384 key half and an AES key half, hash+concat a small JSON payload (`{"a":<action>,"u":"<user>","time":<unix ts>}`), AES-CBC-encrypt with a random IV, base64-encode with MeshCentral's URL-safe alphabet (`+`→`@`, `/`→`$`). Small and fully replicable in Node's built-in `crypto` (`createHash("sha3-384")`, `createCipheriv` with whatever AES variant matches the key2 byte length — verify the exact length once you decode `MESH_LOGIN_KEY` below, don't assume AES-256 without checking).

**Credentials — already added to `/opt/vantra/.env` in production** (do not commit these anywhere, they're server-only env vars, same handling as every other secret in this file):
```
MESH_LOGIN_KEY=<hex key material — TRMM's own core_coresettings.mesh_token, copied over as a one-time manual step>
MESH_LOGIN_USER=vantra-service___4
MESH_WSS_URL=wss://mesh.instaweb.top
```
`MESH_LOGIN_USER` is **not** the raw MeshCentral superuser (`lnpihhvs`, full siteadmin — deliberately not used here, too big a trust escalation to hand a web app) — it's the identity TRMM's `sync_mesh_with_trmm` feature already maps Vantra's own API-key-authenticated requests to today. Confirmed live (queried MeshCentral's own Postgres `main` table) that this identity **already holds per-device rights on real TRMM-known agent nodes** — it's the same identity behind today's working Control/Terminal/File sessions, so reusing it for share-link creation is not a new privilege grant, just a new *use* of an existing one. Add `lib/env.ts` entries for all three (optional, not `required()` — same pattern as every other soft-dependency in this codebase; the view-only toggle degrades to Option 3-style behavior if unset, doesn't crash boot).

**What's still genuinely yours to verify/build** (not resolved by the above — real remaining work, not busywork):
1. **Confirm the exact AES key length** by decoding `MESH_LOGIN_KEY` from hex and checking `key.length - 48` — pick the matching Node `aes-*-cbc` cipher name accordingly, don't guess.
2. **The control-channel command to actually create a view-only share link** once authenticated — this token mechanism gets you a valid MeshCentral login *cookie*, which establishes an authenticated control-channel WebSocket session (same kind `meshctrl.js` itself opens via normal auth); the actual "add a device share link, view-only" **command JSON** sent over that channel is not yet extracted from source — start from `/meshcentral/node_modules/meshcentral/meshagent.js` around line 1792 (`addGuestSharing(flags, viewOnly, func)`) and `apprelays.js` around line 1001 (`MESHRIGHT_REMOTEVIEWONLY`) to find the exact message shape the server expects, and confirm the exact protocol used by shelling out to `node /meshcentral/node_modules/meshcentral/meshctrl.js DeviceSharing --id <a-real-test-agent-mesh-node-id> --add TestGuest --viewonly` on the VPS first (this already works today, confirmed via `--help`, just needs a *working authenticated* invocation — the earlier attempt failed only on which login mechanism to use, not on the command's own validity) and observing what it actually does server-side, before writing the TypeScript equivalent.
3. `app/api/devices/[agentId]/mesh/route.ts`: add a `controlViewOnly` field alongside the existing `control`/`terminal`/`file` fields, generated via the above.
4. `components/remote-tools.tsx`: swap the iframe `src` between `mesh.control` (full) and the new `mesh.controlViewOnly` (view-only) based on the toggle state — same UI/toolbar shape already planned (persistent toggle button, unambiguous mode badge).

**If step 1/2 above turn out to be more involved than expected once you're actually in the code**, Option 3 (the same-day soft guard) remains a legitimate fallback to ship first, with Option 1 as a fast-follow — flag that tradeoff back rather than stalling silently on the crypto/protocol details.

## Verification (whichever option is chosen)

1. If Option 1: confirm on a real connected test agent that the view-only URL genuinely blocks mouse/keyboard input at the protocol level (not just visually) — move the mouse/type in the iframe, confirm the real device does not respond. Confirm the full-control URL still works normally.
2. If Option 3: confirm the "arm" step actually appears before any input reaches the device, and confirm this limitation (a technician can click through and pass keys) is documented in-product somewhere reasonable (a tooltip/help text), not silently overstated as real input-blocking.
3. Either way: confirm this doesn't regress the already-shipped multi-tab (`openControlInNewTab`) or maintenance-overlay toolbar behavior.
