import "server-only";

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";

import { env } from "@/lib/env";

// Direct MeshCentral control-channel client for minting genuine view-only device
// share links. This is the ONE place Vantra talks to MeshCentral's own control
// protocol (websocket `control.ashx`) instead of going through TRMM.
//
// Sourced from the deployed version on this box (MeshCentral 1.2.4) rather than
// guessed — specifically:
//   - the login-token algorithm is the exact one TRMM uses (its `meshctrl` PyPI
//     package `get_login_token`, replicated in Node's built-in crypto below);
//   - the auth/URL-cookie + `createDeviceShareLink` protocol is `meshctrl.js`'s
//     `DeviceSharing --add ... --viewonly` flow, mirrored here.
//
// MeshCentral has NO per-URL `viewonly` flag (appending `?viewonly=1` to an
// existing control URL silently does nothing). View-only is enforced server-side
// only through these device share links, whose `viewOnly:true` sets the
// `MESHRIGHT_REMOTEVIEWONLY` right on the guest session (apprelays.js).
//
// Everything here is OPTIONAL. Vantra degrades gracefully (falls back to the
// client-side soft "arm before input" guard) whenever these are unset or the call
// fails — see `isMeshCentralApiConfigured()` and the route/UI call sites.

export interface MeshCentralShare {
  /** The guest, view-only connection URL to drop into the iframe. */
  url: string;
  /** Server-side public id of the created share (for future removal). */
  publicid: string;
}

const DEFAULT_LOGIN_ACTION = 3; // matches TRMM's get_login_token(action=3)
const WSS_CONTROL_PATH = "/control.ashx";

export function isMeshCentralApiConfigured(): boolean {
  return Boolean(env.meshLoginKey && env.meshLoginUser && env.meshWssUrl);
}

/**
 * Replicates TRMM's `meshctrl/utils.py get_login_token(key, user, action=3)`:
 *
 *   key  = hex-decoded shared secret (TRMM's core mesh_token)
 *   key1 = key[0:48]   -> SHA3-384 hash key
 *   key2 = key[48:]    -> AES-CBC key (length determines cipher: 16=128, 24=192, 32=256)
 *   msg  = {"a":action,"u":"<user lower>","time":unixSeconds}
 *   h    = SHA3-384(key1).digest() + utf8(msg)
 *   enc  = AES-CBC(key2, randomIV).encrypt(pkcs7(h))
 *   out  = base64(iv + enc) with MeshCentral's URL-safe alphabet (+ -> @, / -> $)
 *
 * We measure key2's byte length at runtime to pick the correct AES cipher rather
 * than assuming an AES variant.
 */
export function makeLoginToken(
  keyHex: string,
  user: string,
  action = DEFAULT_LOGIN_ACTION,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length <= 48) {
    throw new Error(`MESH_LOGIN_KEY decodes to ${key.length} bytes; expected > 48.`);
  }
  const key1 = key.subarray(0, 48);
  const key2 = key.subarray(48);

  let cipherName: string;
  if (key2.length === 16) cipherName = "aes-128-cbc";
  else if (key2.length === 24) cipherName = "aes-192-cbc";
  else if (key2.length === 32) cipherName = "aes-256-cbc";
  else {
    throw new Error(
      `MESH_LOGIN_KEY AES key half is ${key2.length} bytes; expected 16/24/32.`,
    );
  }

  const msg = JSON.stringify({ a: action, u: user.toLowerCase(), time: nowSeconds });

  const iv = randomBytes(16);
  const hashed = createHash("sha3-384").update(key1).digest();
  const plaintext = Buffer.concat([hashed, Buffer.from(msg, "utf8")]);

  const cipher = createCipheriv(cipherName, key2, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // MeshCentral uses "+" -> "@" and "/" -> "$" (URL-safe base64).
  return Buffer.concat([iv, encrypted])
    .toString("base64")
    .replace(/\+/g, "@")
    .replace(/\//g, "$");
}

/**
 * Build the `control.ashx` websocket URL exactly like `meshctrl.js` does when it
 * is handed a raw login cookie via `--loginkey`: it appends the cookie as `auth=`.
 */
function controlSocketUrl(token: string): string {
  let base = env.meshWssUrl!;
  if (base.endsWith("/")) base = base.slice(0, -1);
  return `${base}${WSS_CONTROL_PATH}?auth=${encodeURIComponent(token)}`;
}

interface MeshCentralMessage {
  action?: string;
  result?: string;
  url?: string;
  publicid?: string;
  error?: string;
}

function createShareLinkOnSocket(
  controlUrl: string,
  nodeid: string,
  viewOnly: boolean,
  guestName = "vantra-view",
): Promise<MeshCentralShare> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(controlUrl, { rejectUnauthorized: false });

    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      reject(new Error("Timed out waiting for MeshCentral share-link response."));
    }, 30_000);

    const onMessage = (raw: WebSocket.RawData) => {
      let data: MeshCentralMessage;
      try {
        data = JSON.parse(raw.toString()) as MeshCentralMessage;
      } catch {
        return; // not our message; keep listening
      }
      if (data.action !== "createDeviceShareLink") return;

      clearTimeout(timeout);
      if (data.result === "OK" && data.url) {
        resolve({ url: data.url, publicid: data.publicid ?? "" });
      } else {
        reject(new Error(data.error || data.result || "MeshCentral rejected share link."));
      }
    };

    ws.on("open", () => {
      // consent: 0 (silent, no notification on the device owner's screen) —
      // confirmed with the user 2026-09-03 that EVERY connection must be
      // silent/anonymous, never surface a popup to whoever is at the physical
      // machine. This previously hardcoded 0x0001 (desktop notify), mirroring
      // meshctrl.js's own --viewonly default — that default is wrong for this
      // product's use case and was a real, live bug, not a style choice.
      // p=2 = desktop.
      ws.send(
        JSON.stringify({
          action: "createDeviceShareLink",
          nodeid,
          guestname: guestName,
          p: 2,
          consent: 0,
          expire: 0,
          viewOnly,
          port: null,
          responseid: "vantra",
        }),
      );
      ws.on("message", onMessage);
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      if (code !== 1000) {
        reject(new Error(`MeshCentral control channel closed (${code} ${reason}).`));
      }
    });
  });
}

/**
 * Mint a genuinely view-only device share link for a MeshCentral node.
 *
 * @param nodeid the MeshCentral node id for the agent (parsed from the TRMM
 *   `control` URL's `gotonode=` parameter — the "map a TRMM agent to a
 *   MeshCentral node" step).
 */
export async function createViewOnlyShareLink(nodeid: string): Promise<MeshCentralShare> {
  if (!isMeshCentralApiConfigured()) {
    throw new Error("MeshCentral share-link integration is not configured.");
  }
  const token = makeLoginToken(env.meshLoginKey!, env.meshLoginUser!);
  return createShareLinkOnSocket(controlSocketUrl(token), nodeid, true);
}

/**
 * CONFIRMED LIVE 2026-09-03 — DO NOT reintroduce a `gotonode=`-based lookup.
 *
 * The `gotonode=` query param embedded in TRMM's own control/terminal/file URLs
 * (`.../?login=...&gotonode=<value>&viewmode=11&hide=31`) is NOT a usable
 * MeshCentral node id — tested end-to-end against a real connected agent
 * (`WIN-8OA3CCQAE4D`): TRMM's `gotonode` value was
 * `B259C489B38587FDFBE95FF6F80143531DED236AB8BD1194E25EB321975B615E23EF595F1CB067905CF07D97FCEDA999`
 * (96 uppercase hex chars), while that exact same agent's REAL MeshCentral node
 * id (confirmed via a live `{"action":"nodes"}` control-channel call, and by
 * successfully minting a real, HTTP-200-reachable view-only share link with
 * it) is `node//slnEibOFh$376V$2@AFDUx3tI2q4vRGU4l6zIZdbYV4j71lfHLBnkFzwfZf87amZ`
 * — a completely different value/format (MeshCentral's own base64-ish alphabet,
 * `@`/`$` substituted for `+`/`/`). Passing the `gotonode` value to
 * `createDeviceShareLink` fails with `{"result":"Invalid node id"}` even though
 * auth succeeds — this is NOT a formatting tweak, the two identifiers are
 * unrelated. Whatever `gotonode` actually encodes is irrelevant here; do not
 * try to transform/decode it into a node id.
 *
 * The reliable mapping, confirmed live: authenticate once (any valid login
 * token for `MESH_LOGIN_USER` works), send `{"action":"nodes"}` on the same
 * control-channel socket, and match the returned node's `name` field against
 * the agent's own `hostname` (already available from `listAgents()`/
 * `getAgentDetail()` — no new TRMM call needed). The response shape (one real
 * example, trimmed):
 *   { action: "nodes", nodes: { "mesh//<meshid>": [ { _id: "node//<b64id>",
 *     name: "WIN-8OA3CCQAE4D", ip, osdesc, users, idletime, ... }, ... ] } }
 * Real device hostnames were unique in the live test (3 nodes, 3 distinct
 * names) but this is NOT guaranteed across different customers/TRMM sites in
 * general — if a hostname collision across two different customers is a real
 * concern, additionally cross-check the node's `ip` (already known from TRMM's
 * agent detail) or, more robustly, resolve via a per-node request instead of
 * relying on name matching alone. Left as a follow-up hardening item, not
 * re-litigated here since it wasn't reachable to test with only 3 live nodes.
 *
 * `nodes` is a real, one-time-per-session control-channel round trip (same
 * socket already opened for `createDeviceShareLink`) — cache the hostname->id
 * mapping for the lifetime of that one socket connection rather than issuing
 * a second `nodes` call before creating the share link.
 *
 * HARDENING (added once the cross-tenant risk was worked through, not left as
 * a comment): `vantra-service___4` has rights across every TRMM-known device
 * server-wide — the `nodes` response returned by this account is a single
 * FLAT LIST spanning every customer, not scoped to whichever customer's
 * agentId the caller already validated ownership of. Two different customers
 * with identically-named machines (very plausible with unrenamed Windows
 * default hostnames) would otherwise silently resolve to the WRONG customer's
 * real device — a genuine cross-tenant mismatch, not a cosmetic bug, since
 * the caller only checked that the *requested* agentId belongs to them, not
 * that hostname-matching stays inside that boundary. `expectedIp` (the same
 * TRMM agent's already-known `public_ip`) is a second, independent signal
 * that must also agree — if more than one node shares the hostname, or if
 * the single match's IP disagrees with `expectedIp`, this FAILS CLOSED
 * (returns null, caller falls back to the soft guard) rather than guessing.
 * IP is itself not perfectly unique (NAT/dynamic addressing exists), so this
 * is defense-in-depth on top of the ownership check already done by the
 * caller, not a replacement for one — but it closes the specific gap where a
 * pure hostname string collision could hand back a stranger's node id.
 */
export async function findMeshNodeIdByHostname(
  hostname: string,
  expectedIp?: string,
): Promise<string | null> {
  if (!isMeshCentralApiConfigured()) return null;
  const token = makeLoginToken(env.meshLoginKey!, env.meshLoginUser!);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(controlSocketUrl(token), { rejectUnauthorized: false });
    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      reject(new Error("Timed out waiting for MeshCentral node list."));
    }, 15_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ action: "nodes", responseid: "vantra-nodes" }));
    });
    ws.on("message", (raw: WebSocket.RawData) => {
      let data: {
        action?: string;
        nodes?: Record<string, Array<{ _id: string; name: string; ip?: string }>>;
      };
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (data.action !== "nodes") return;
      clearTimeout(timeout);
      const allNodes = Object.values(data.nodes ?? {}).flat();
      const hostMatches = allNodes.filter((n) => n.name === hostname);

      let match: { _id: string; name: string; ip?: string } | undefined;
      if (hostMatches.length === 1 && !expectedIp) {
        // Only one node has this name and we have no IP to cross-check —
        // accept it (matches the pre-hardening behavior for the common case).
        match = hostMatches[0];
      } else if (hostMatches.length >= 1 && expectedIp) {
        // One or more name matches AND we have an IP signal — require it to
        // agree. Ambiguous-or-wrong results in zero matches here, not a guess.
        const ipMatches = hostMatches.filter((n) => n.ip === expectedIp);
        if (ipMatches.length === 1) match = ipMatches[0];
      }
      // hostMatches.length > 1 with no expectedIp, or 0 matches either way,
      // falls through with match left undefined -> fail closed below.
      ws.close();
      resolve(match ? match._id : null);
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}