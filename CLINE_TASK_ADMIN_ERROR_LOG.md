# Cline Task — Admin API error-logging tab (nothing fails silently)

**Repo**: `/Users/mikeolab/vantra`. **Scope**: new Prisma model + a small logging helper + wiring into existing API routes + a new admin tab.

**Request, verbatim**: "i need all failures especially api failures logged in a tab in the admin with there actual error for diagnosis, i dont want anything failing silently, also copy the settings we use in channelry for our admin, the way we track things." (Channelry is a separate product of the user's — its exact admin-tracking UI isn't accessible from this repo; build against this repo's own already-established patterns instead, described below, which is the same "audit every send/every attempt" discipline already used for `NotificationLog`.)

## What already exists — the pattern to extend, not invent from scratch

`lib/notification-log.ts` / the `NotificationLog` model already do exactly this for one category (notification sends): every attempt is logged with outcome (`sent`/`failed`) and an error message, surfaced in an admin tab. This task is the same discipline applied to **API route failures generally** — every `catch` block across the app that currently does `console.error(...)` and returns a generic error to the client should ALSO write a durable, admin-visible record, not just a log line that scrolls away in `journalctl`.

## What to build

1. **New `ApiErrorLog` Prisma model**: `id, route (string, e.g. the pathname), method (string), statusCode (int), errorMessage (string), stack (string, nullable), userId (string, nullable — who was making the request, if known), createdAt`. Additive migration.
2. **`lib/api-error-log.ts`** — a `logApiError(input: { route, method, statusCode, error, userId? })` helper mirroring `logNotification`'s own "never throws, logging must never break the request" contract (wrap its own DB write in try/catch, swallow failures, `console.error` as a last resort).
3. **Wire it into every existing `catch` block that currently only does `console.error`** across `app/api/**` — this is a real, repo-wide sweep, not a single file. Prioritize the ones already known to matter most: `listAgents` failures (`app/api/devices/route.ts`), `getMeshCentralUrls` failures (`app/api/devices/[agentId]/mesh/route.ts`), any TRMM API call catch block, payment-processing catches, script-run/reboot/shutdown catches. Add the call right where `console.error` already happens — don't remove the console.error, add logApiError alongside it.
4. **New admin tab** `/admin101/errors` (mirror the existing `/admin101/payments`/`/admin101/users` page pattern exactly — same table/Th/Td components, same auth gate): lists `ApiErrorLog` rows, most recent first, with route/method/status/error message columns, a way to see the full stack trace (expandable row or a details page), and a simple filter by route or date range. Add "Errors" to the admin nav alongside Users/Payments/VPS/Wallets.
5. **Add to `components/admin/*`** whatever shared admin-nav component lists the existing tabs, so "Errors" appears alongside them consistently.

## Explicitly not this task

- Don't touch SpaceWorker — this is scoped to Vantra only for now; if the same pattern is wanted there later, it's a separate task (SpaceWorker's own `NotificationLog` from Task 8 is the equivalent starting point over there).
- Don't attempt to log EVERY console.log/console.error in the whole codebase in one pass if the sweep turns out to be very large — prioritize the API route catch blocks (user-facing failures), note in your final report which files you covered and which you deliberately deferred, so nothing is silently skipped without being said out loud.

## Verification

1. Force a real failure (e.g., temporarily break a TRMM API call, or use a known-bad agent id) and confirm a corresponding row appears in `/admin101/errors` with the real error message and stack trace, not a placeholder.
2. Confirm the API request that triggered it still returns its normal error response to the client — logging must never change or break the existing error-handling behavior of any route.
3. Confirm the new admin tab is reachable from the existing admin nav and matches the visual style of the other admin pages.
