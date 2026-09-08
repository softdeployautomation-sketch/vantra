# Vantra

A customer portal for a self-hosted TacticalRMM instance. Customers sign up,
verify their email, and get a branded dashboard to add/monitor devices — without
ever seeing the RAW TRMM UI or credentials.

## Stack

- Next.js 16.2.9 (App Router), React 19.2.4, Tailwind CSS v4, TypeScript 5
- Prisma + PostgreSQL (own DB, zero shared tables with TRMM's Django DB)
- Auth: `bcrypt` password hashing + `jose`-signed session JWTs
- Email: Resend
- TRMM: server-side HTTP client (`lib/trmm.ts`) using a dedicated API key

## Getting started (local dev)

```bash
cp .env.example .env   # fill in real values
npm install
npx prisma migrate dev --name init
npm run dev            # http://localhost:3300
```

## Environment variables

See `.env.example`. Key ones:

- `TRMM_API_BASE_URL` / `TRMM_API_KEY` — TacticalRMM API access (server-side only).
- `DATABASE_URL` — Postgres connection string.
- `SESSION_SECRET` — 32+ random bytes used to sign session JWTs.
- `RESEND_API_KEY` / `EMAIL_FROM` — transactional email.
- `APP_BASE_URL` — public base URL (used for any absolute links).
- `DEPLOYMENT_EXPIRY_HOURS` (default 72), `MAX_DEVICES_FREE_TIER` (default 3).

## Folder layout

```
app/
  page.tsx                 # marketing landing (public)
  signup/ login/ verify/   # public auth pages
  dashboard/               # auth-gated device list + Add Device flow
  api/auth/                # signup, verify, resend-code, login, logout route handlers
  api/devices/             # live status (GET) and deployment creation (POST)
components/                # UI primitives, shell, forms, device/modal components
lib/
  trmm.ts                  # TRMM API wrapper (server-only, verified shapes)
  auth.ts                  # bcrypt + jose session signing
  email.ts                 # Resend wrapper
  rate-limit.ts            # IP rate limiting (RateLimitEvent table)
  env.ts                   # typed env accessor
  db.ts, provision.ts, verify-code.ts, session-user.ts
proxy.ts                   # Next 16 proxy (auth gate for /dashboard/**)
prisma/schema.prisma
```

## Notes

- `lib/trmm.ts` is `import "server-only"` and holds the secret TRMM key — it must
  never be imported from a client component.
- Note: Next.js 16 renamed `middleware.ts` to `proxy.ts`; the auth gate lives in
  `proxy.ts`.
- Deployment / VPS configuration (nginx, systemd, DNS, certbot) is handled
  separately.

## ⚠️ Live MeshCentral patch (outside this repo)

One production fix lives as a **direct edit to the self-hosted MeshCentral
install on the VPS**, NOT in this repo: `gotoStartViewPage()` in
`/meshcentral/node_modules/meshcentral/views/default3.handlebars` is patched so
a deep-link URL (`?gotonode=...&viewmode=11`) auto-connects the desktop/terminal/
files panel the same way MeshCentral's own `cmaction()` does — without it, a
customer who already clicked "Connect to device" in Vantra still had to click
MeshCentral's "Connect" a second time.

Any MeshCentral software upgrade that re-installs `default3.handlebars` silently
reverts this patch. See **TASK_18_TERMINAL_AND_FILES_REDESIGN.md → Phase 0** for
the exact diff and re-apply it after every MeshCentral update.