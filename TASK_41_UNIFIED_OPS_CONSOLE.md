# Task 41 — A unified Ops Console: one login, both platforms, a split view

**Status: ready to build.** SpaceWorker's own side of this is already done and deployed (`next.config.ts` now sends `Content-Security-Policy: frame-ancestors 'self' https://vantra.instaweb.top;`, so it can be iframed from this app specifically — that gate is live, no waiting on it). Everything else below is Vantra-side only.

## The ask, as given (2026-09-14)

> I think its best we have a single link for both and It shouldn't be /admin,,,,maybe just add this as a sub tab from home, so I can view vantra and space worker, and option to show both on a screen at the same time while I navigate both, I see we have some stuff of space worker in vantra, so lets make this a task.. consolidate both and make sure we make it nicer, the admin is too confusing.

Context: the owner runs two separate products on the same VPS — Vantra (this repo, an RMM/technician-session platform) and SpaceWorker (lead-gen/outreach SaaS, a completely separate Next.js app on the same box, port 3500). Each has its own admin panel with its own passcode login (`vantra.instaweb.top/admin101` and `spaceworker.instaweb.top/admin`). He noticed Vantra's admin already has a "Platform" tab that pings SpaceWorker's reachability (`lib/platform-status.ts`) — a hint of cross-product awareness that was never finished — and wants that turned into a real, navigable, single admin experience for managing both.

## Visual reference

A mockup of the target layout — top bar with a platform switcher (Vantra / SpaceWorker / Split), the Split view showing both platforms side by side live, and a per-panel "Expand" button — is published here: **https://claude.ai/code/artifact/d593081d-6d12-460e-a4ae-878480f3a1f4** (v2). It's a deliberately neutral "control room" look (dark, monospace accents for status/numbers), NOT Vantra's own indigo brand or SpaceWorker's amber brand — this shell manages both products, so it shouldn't visually read as belonging to either one. Match its structure (top bar, segmented switcher, split-panel layout, per-panel color dot + hostname label + Expand button) — the sample stat cards/rows in each panel are illustrative, not literal data to hardcode.

## Why this app hosts it, not a new third app

Both apps already use the IDENTICAL admin-auth pattern (`ADMIN_TOKEN` passcode, `verifyAdminPasscode`/`setAdminSessionCookie`, rate-limited login) — confirmed by reading both `lib/admin-auth.ts` files side by side. Both run on the same VPS, and `lib/platform-status.ts` already proves Vantra's server can reach SpaceWorker directly over `127.0.0.1:3500`. Building a THIRD separate app/deployment to host a "unified" console would mean a third auth system and a third thing to maintain — extending Vantra's existing, richer admin (`/admin101`, already has Users/Payments/Wallets/Platform/VPS/etc.) is the smaller, more maintainable move, and it's already halfway there.

## 1. The easy fix: iframe SpaceWorker's real admin, not a data re-implementation

Do NOT rebuild SpaceWorker's admin tabs (Users, Payments, Wallets, AI, Queue, Services...) natively inside Vantra — that's a huge, ongoing-maintenance duplication (every future SpaceWorker admin change would need a matching Vantra-side change). Instead: a plain `<iframe src="https://spaceworker.instaweb.top/admin">` inside the new console. This is now genuinely simple because SpaceWorker's CSP already allows it from this origin.

**On first use in a browser**, the iframe shows SpaceWorker's own login screen (one passcode entry) — after that, SpaceWorker's own session cookie persists for that browser, so subsequent visits go straight to its dashboard inside the frame. This is NOT full single sign-on (the owner still enters SpaceWorker's passcode once per browser) — true SSO (Vantra's server silently authenticating to SpaceWorker server-side) is a real, larger undertaking (proxying an entire second Next.js app's asset pipeline correctly is known-hard) and is explicitly **out of scope for this pass** — flagged as a future enhancement below, not something to attempt now. "One login, both platforms" in the mockup's badge is the eventual goal; what ships here is "one login per platform, remembered after the first visit," which is still a massive improvement over today's two-separate-panels reality.

## 2. New route + nav entry

Add a new protected route (e.g. `app/admin101/(protected)/console/page.tsx`, or promote it to the admin section's actual landing page — Cline's call) with:
- A top bar: wordmark "Ops Console", the 3-way segmented switcher (**Vantra** / **Split** / **SpaceWorker**), a small "both reachable" indicator reusing `getPlatformStatus()` from `lib/platform-status.ts` (already built, just needs to be rendered here instead of only on the existing Platform tab).
- **Vantra** mode: today's existing admin content (whatever currently renders at the admin home) — no change to it, just reachable from this switcher.
- **SpaceWorker** mode: the full-width iframe.
- **Split** mode: a two-column CSS grid, left = Vantra's own admin content rendered natively in place (same-origin, no iframe needed since we're already inside Vantra), right = the SpaceWorker iframe. This is the literal "show both on a screen at the same time while I navigate both" ask — make sure BOTH sides stay independently scrollable/navigable (the user should be able to click around in the Vantra side without losing their place in the SpaceWorker iframe, and vice versa).
- **Expand-one-panel, decided 2026-09-14**: each panel header gets a small "Expand" button (see the updated mockup, v2) that grows that one panel to the full width of the console — a quick way to focus on one platform without fully leaving Split mode and losing the other panel's state. Clicking it again (or a "Back to split" affordance that appears once expanded) returns to the normal two-column layout. Implement this as local UI state only (which panel, if any, is expanded) — it must NOT unmount or reload the collapsed panel's iframe/content, just resize it via CSS (e.g. toggling one grid column's width between `1fr` and `0` with `overflow:hidden`, or conditionally rendering `grid-template-columns: 1fr 0fr` vs `1fr 1fr`) — the whole point is coming back to find the other side exactly as it was, not a fresh reload.

Add a prominent, clearly-labeled entry point to this new page from Vantra's existing admin sidebar (call it **"Console"**, not a sub-item buried under "Platform") — this satisfies "add this as a sub tab from home" once it's one click from wherever the admin currently lands after login.

## 3. Naming — get out of "/admin" as the perceived front door

The owner's "It shouldn't be /admin" is about how this FEELS day-to-day, not necessarily a hard technical requirement to migrate every URL. Cheapest correct fix: keep `/admin101` working (don't break bookmarks/muscle memory), but make **"Console"** the thing that's actually labeled and reached day-to-day — the nav entry, the page `<title>`, and (if easy) redirect the bare `/admin101` landing straight into `/admin101/console` once logged in, so in practice the owner never has to think of it as "the admin" again, just "the Console."

## 4. Iframe practicalities

- Give the iframe a real `title` attribute (accessibility) and a sensible fixed or `100%` height inside its panel — SpaceWorker's own admin pages already scroll internally, so the iframe itself doesn't need to grow with content.
- Standard iframe security hygiene: no `allow-top-navigation` in any `sandbox` attribute if one is used (don't let embedded content navigate the parent), but DO allow normal same-origin-to-SpaceWorker cookies/forms to work — in practice this likely means NOT setting a restrictive `sandbox` attribute at all (SpaceWorker is a fully trusted first-party app the owner controls, not arbitrary third-party content), just `src` + `title` + sizing. Cline's judgment call if a light `sandbox` allowlist reads cleaner, as long as login/forms/cookies keep working.
- If SpaceWorker's admin pages ever set `Set-Cookie` with `SameSite=Strict`, a cookie set INSIDE the iframe might not behave as expected in some browsers — check this live once built (log in inside the iframe, reload the parent page, confirm the SpaceWorker panel stays logged in) rather than assuming.

## Explicitly out of scope

- True single sign-on (Vantra's server silently authenticating to SpaceWorker on the owner's behalf, or a real reverse-proxy of SpaceWorker's whole app through Vantra's own routes) — a real, larger project; note it here as the natural next step once this iframe version is live and proven, don't build it now.
- Rebuilding SpaceWorker's admin data natively in Vantra's UI — the iframe IS the integration; don't duplicate.
- Any change to Vantra's own existing admin tabs' functionality — this task only adds the new Console entry point around them.

## Verification expected

- `npx tsc --noEmit` / `npm run build` clean.
- Live: log into Vantra's admin, reach the new Console entry in one click, confirm all three switcher modes render correctly, and confirm Split mode lets you scroll/click in both panels independently without either losing state.
- Confirm the SpaceWorker iframe actually loads (not blocked) — this depends on SpaceWorker's `next.config.ts` CSP change already being live in production; if it's blocked, check that deploy landed before assuming this task's code is wrong.
- Confirm logging into SpaceWorker inside the iframe once, then reloading the parent Console page, keeps the SpaceWorker panel logged in (cookie persistence working as expected).
- Confirm each panel's Expand button grows it to full width and back, and — critically — that expanding/collapsing never reloads the SpaceWorker iframe or resets scroll position on either side (click into something on the SpaceWorker side, expand Vantra, collapse back to split, confirm SpaceWorker is exactly where you left it).
