# Task 42 — Marketing page redesign + Pricing/Privacy pages, SpaceWorker-quality craft with Vantra's own identity

**Status: ready to build.** Independent of Task 41 (Ops Console) — different files, no overlap.

## The ask, as given (2026-09-14)

> and I really like the ui for space worker, the tokens and alll,, why not try to use that on vantra as well, we can make vantra better, change the colour so they don't look the same though. Lets have a task for vantra marketing redesign with all the terms and pricing and then change the ui to fit or better.

Two phases: **(1) this task** — bring Vantra's landing page up to the same craft level as SpaceWorker's redesign (real design tokens, not ad-hoc Tailwind classes scattered per-component), add the two pages Vantra is missing (Pricing, Privacy — it already has `/terms`), and establish a refined design-token system Vantra can keep building on. **(2) a later task** — roll those same tokens through the rest of Vantra's actual product UI (the admin console, the technician dashboard) once phase 1's direction is confirmed working well. Don't start phase 2 without the owner looking at phase 1 first.

## What "SpaceWorker's tokens" actually means, concretely

SpaceWorker's `app/globals.css` defines a real token system: a 10-step brand color ramp (`--color-brand-50` through `900`), semantic light/dark tokens (`--bg`, `--bg-elevated`, `--fg`, `--fg-muted`, `--border`) that swap under a `.dark` class via `@theme inline`, and a deliberate two-font pairing (Sora for display/headings, Karla for body, both via `next/font/google`) — then EVERY component (`components/ui.tsx`'s `Button`/`Card`/`Badge`) is built strictly from those tokens, never a one-off color. Vantra's own `app/globals.css` already has the identical STRUCTURE (same `@theme`/`@theme inline` pattern, same `.dark` class swap) — it just has generic, under-designed values: `brand-600: #4f46e5` (a very common, un-distinctive Tailwind-default indigo) and a plain gray neutral scale (`bg: #f9fafb`, `fg: #111827`), with no custom font pairing (system font stack only). The MECHANISM is already right; the actual VALUES need real craft.

## 1. A real, distinct color identity — NOT SpaceWorker's amber, but not generic indigo either

Keep Vantra in the cool-toned family (it's an ops/technical/RMM product — a warm amber like SpaceWorker's would read wrong here, and the owner explicitly wants them visually distinct anyway) — but replace the generic `#4f46e5` Tailwind-default indigo with a deliberately chosen, richer color built the same way SpaceWorker's was: pick ONE hue, derive a full 50-900 ramp from it in oklch (matching SpaceWorker's own documented method — see the `artifact-design` skill's color guidance if useful), and make sure it's genuinely distinctive rather than "the first indigo in the Tailwind palette." A deep, slightly desaturated indigo-violet or a technical slate-blue both fit an RMM product's register well — Cline's (or a design pass's) call on the exact hue, but it must be a deliberate choice with a real ramp, not a copy-pasted default.

## 2. A real font pairing

Pick a display/body pairing the same way SpaceWorker did (Sora + Karla, loaded via `next/font/google`, wired into `--font-display`/`--font-sans`) — NOT the same two fonts (that would make the products feel like reskins of each other), but matching the CRAFT of "a considered pairing, not the system font stack." Two options if a design pass isn't done first: pick something with a slightly more technical/engineered character than SpaceWorker's rounded Sora — e.g. a geometric sans for display headings paired with a clean, highly-legible body face — or run this through the `design` skill properly before committing, the same way SpaceWorker's landing page mockup was built this session, so the owner sees it before it's coded.

## 3. Redesign the landing page against this new system

`app/page.tsx` (273 lines) already has real content (a 4-step "how it works," a features grid, real RMM positioning) — this is a restyle + structural polish pass, not a from-scratch rewrite like SpaceWorker's was. Reuse the existing copy/sections as the base; elevate the visual execution (spacing, hierarchy, the hero treatment, card styling) to match SpaceWorker's landing page's level of polish, using Vantra's own new tokens throughout.

## 4. Add the missing Pricing and Privacy pages

Vantra has `/terms` already but no `/pricing` and no `/privacy` — the exact same gap SpaceWorker had before its own Task 42. Same requirement applies: **write real content grounded in what Vantra actually does and actually collects** (device telemetry, technician session data, ticket contents, the existing BTC/USDT payment flow's transaction data — check `app/admin101/(protected)/wallets` and the `Payment`-equivalent model here for what's real before writing the Privacy page's data-collected section), not generic boilerplate. Pricing should reflect whatever Vantra's actual plan/pricing structure is today (check `AdminSettings`-equivalent pricing fields already in this codebase rather than inventing new numbers) — if Vantra doesn't have a formalized plan/tier structure yet, that's a real business decision to raise back to the owner rather than guess, the same way SpaceWorker's EXE prices were asked for directly rather than assumed.

## Explicitly out of scope for this pass

- Rolling the new tokens through the rest of the app (the technician/admin dashboards) — phase 2, a separate task, only after the owner has seen and approved this phase's direction.
- Task 41's Ops Console — unrelated, different files, can proceed in parallel.

## Verification expected

- `npx tsc --noEmit` / `npm run build` clean.
- Confirm dark mode still swaps correctly (the `.dark` class mechanism is unchanged, only the token VALUES change) — check both light and dark on the redesigned landing page.
- Confirm `/pricing` and `/privacy` are real, reachable routes with real content, linked from the landing page footer/nav the same way SpaceWorker's are.
- Show the owner the redesigned landing page before starting any phase-2 rollout to the rest of the app — this task's whole point is confirming the direction works before it spreads further.
