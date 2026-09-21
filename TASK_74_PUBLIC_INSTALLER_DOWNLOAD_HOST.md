# Task 74 — Public-tier installers still download from dl.instaweb.top, not dl.broks.beauty

**Found live 2026-09-21** — owner generated a real installer on a freshly-created PUBLIC org and got back `https://dl.instaweb.top/d/<uuid>`. That's wrong: the whole point of the public/private domain split (Task 53/59-61) is that bulk/public traffic never touches the protected `instaweb.top` surface, and Task 66 already provisioned `dl.broks.beauty` (DNS + nginx, verified live, mirrors `dl.instaweb.top.conf`) specifically as its public counterpart — but nothing in the app actually points public-tier downloads at it yet.

## Root cause, confirmed by reading the code (not guessed)

Task 61 made the **agent's own check-in host** tier-aware (`resolveAgentApiBaseUrl`/`agentApiBaseUrl` threaded through `deployUrl()`, `createManualInstaller()`, etc. — this part is correct and unaffected by this task). But that's a **different URL from the installer's own download link**:

- `deployUrl(uid, apiBase)` (`lib/trmm.ts`) → `{apiBase}/clients/{uid}/deploy/` — TRMM's own merged/separated download path. Already tier-aware via `apiBase`. **Not the bug.**
- ZIP method: `callZipGenerator()` (`lib/zip-generator.ts`) POSTs to `env.zipGeneratorUrl` (a fixed `MSI_GENERATOR_URL`/`ZIP_GENERATOR_URL`, not tier-aware at all) and the EXTERNAL generator service itself returns `downloadUrl` in its response — this is where `dl.instaweb.top/d/...` comes from.
- MSI method: `callMsiGenerator()` (`lib/msi-generator.ts`) — same generator service, same issue.

Both generator calls have no concept of tier today; the download host they hand back is whatever the generator service is configured to serve from, unconditionally.

## Scope

1. **Confirm how the generator service picks its response host** before choosing a fix — two real approaches depending on what's actually true:
   - If the generator service's `/build` (and MSI equivalent) response `downloadUrl` is a simple, predictable shape (`https://dl.instaweb.top/d/<uuid>`), the lowest-risk fix is a **post-processing swap in Vantra**: after getting the response back in `app/api/devices/deployments/route.ts`, when the org is public-tier, rewrite the host from `dl.instaweb.top` to `dl.broks.beauty` before returning it to the caller — no change to the external generator service needed. Both hostnames already point at the same backend (Task 66's nginx config mirrors the existing vhost verbatim), so this is purely a display/host-swap, not a routing change.
   - If that's too fragile (URL shape not guaranteed, or the generator signs/embeds the host in a way a naive string-swap would break), the alternative is passing a `downloadHost` (or similar) param in the POST body to the generator and having IT construct the link with the right host — this needs the generator service's own source, which isn't in this repo; check `MSI_GENERATOR_URL`'s deployment (likely a separate service checked out elsewhere on the VPS) before assuming this path is available.
2. **Resolve org tier the same way Task 61 already does** in `app/api/devices/deployments/route.ts` (`resolveAgentApiBaseUrl`/`isPrivateTier` from `lib/agent-domain-tier.ts`) — reuse it, don't re-derive tier logic a second time.
3. **Private-tier orgs keep `dl.instaweb.top` unchanged** — this task only changes the PUBLIC-tier default.
4. Apply to both `callZipGenerator` and `callMsiGenerator` call sites — this is the same underlying gap in both, not two separate bugs.

## Out of scope

- Don't touch `deployUrl`/the merged/separated methods' download path — already correctly tier-aware.
- Don't re-verify Task 66's infra (already confirmed live: `dl.broks.beauty` resolves, has a valid cert, nginx serves it, mirrors the private vhost).
- Don't change what `TRMM_PUBLIC_API_BASE_URL`/`TRMM_PRIVATE_API_BASE_URL` mean or how they're resolved — this task is specifically about the DOWNLOAD LINK's host, a separate concern from the agent's own check-in host.

## Verification expected

- Generate a ZIP installer on a public-tier org: the returned/displayed download link's host is `dl.broks.beauty`, not `dl.instaweb.top`.
- Generate an MSI installer on a public-tier org: same.
- Generate either on a PRIVATE-tier org (e.g. Sc01t or Mblast): still `dl.instaweb.top`, completely unchanged — regression-check this explicitly.
- The actual returned link is reachable and serves the real file (not just a host string swap that happens to look right but 404s) — confirm live, not just by inspecting the response JSON.
