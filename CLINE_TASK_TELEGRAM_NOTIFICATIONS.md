# Cline Task — Telegram Notifications (Admin Ops Alerts + Customer Self-Serve)

**Repo**: `/Users/mikeolab/vantra`. **Scope**: app code.

**Status: the bot exists and env vars are already configured on the VPS** — `@BrandappBot`, live at `t.me/BrandappBot`. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, and `INTERNAL_CRON_SECRET` are already set in `/opt/vantra/.env` (done by Claude over SSH). `ADMIN_TELEGRAM_CHAT_ID` is the one remaining value, pending — Claude will add it and register the webhook once available; this does not block Cline writing any of the code below. **Do not treat any of the four env var names in this doc as placeholders needing a different name** — they're final.

## Context

Two genuinely separate audiences share one Telegram bot:
1. **Admin/ops alerts** — a single fixed chat (the operator's own) gets pinged for: a manual crypto payment that needs human review, a new user signing up, and the VPS crossing a memory-pressure threshold (reusing the metrics already built in `lib/vps-status.ts`/the admin VPS tab).
2. **Customer self-serve alerts** — each customer can link their own Telegram chat to their Vantra account and receive their own notifications: their device going offline/online, and replies on their support tickets.

**Important discovery while scoping this**: `User.notifyDeviceOffline` and `User.notifyTicketReply` **already exist in the Prisma schema** and are already exposed as toggles in Settings — but the actual delivery mechanism was explicitly never built (the original V3 plan documented this: "UI + persisted preference only this pass — the backend jobs that actually check device status or fire on ticket replies are explicitly out of scope"). **This task is what finally implements that deferred piece**, using Telegram as the delivery channel. Do not add new preference fields for these two — reuse the existing booleans.

## 1. `lib/env.ts` additions (all optional — never `required()`, same posture as every other soft-dependency in this codebase)

```ts
telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
adminTelegramChatId: process.env.ADMIN_TELEGRAM_CHAT_ID || null,
telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null, // e.g. "VantraAlertsBot", no @ prefix — needed to build the customer deep-link
```

## 2. `lib/telegram.ts` (new, `import "server-only"`)

```ts
import "server-only";
import { env } from "./env";

/** Fire-and-forget by design — a Telegram outage must never break the request
 * that triggered the notification (signup, payment submit, etc). Logs and
 * swallows any failure. No-ops entirely if the bot isn't configured. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!env.telegramBotToken) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Telegram sendMessage threw:", err);
  }
}

/** Ops alerts — always goes to the one fixed admin chat, never a customer's. */
export function notifyAdmin(text: string): Promise<void> {
  if (!env.adminTelegramChatId) return Promise.resolve();
  return sendTelegramMessage(env.adminTelegramChatId, text);
}

export function telegramLinkUrl(token: string): string | null {
  if (!env.telegramBotUsername) return null;
  return `https://t.me/${env.telegramBotUsername}?start=${token}`;
}
```

## 3. Prisma additions

```prisma
model User {
  // ...existing fields unchanged, including notifyDeviceOffline/notifyTicketReply which already exist...
  telegramChatId             String?   @unique
  telegramLinkToken          String?   @unique
  telegramLinkTokenExpiresAt DateTime?
}

// Tracks last-seen agent status per user, purely so the offline/online poller
// can detect a TRANSITION (not just current state) without re-notifying every
// cycle while a device stays offline. Keyed by TRMM agent_id (opaque string,
// same "no local FK to TRMM" posture as DeviceGroupMember in the device-groups task).
model DeviceStatusSnapshot {
  id         String   @id @default(cuid())
  userId     String
  agentId    String
  lastStatus String   // "online" | "offline" | "overdue"
  updatedAt  DateTime @updatedAt

  @@unique([userId, agentId])
}

model AdminSetting {
  // ...existing fields unchanged (btcAddress, usdtTrc20Address)...
  lastLowMemAlertAt DateTime? // debounce — don't re-alert every poll while memory stays high
}
```

## 4. Telegram webhook (the linking flow)

`app/api/telegram/webhook/route.ts` — `POST`, receives Telegram Bot API update objects. **Auth is a header, not a session**: Telegram lets you set a secret string when registering the webhook, delivered back on every request as `X-Telegram-Bot-Api-Secret-Token`. Reject (401) if it doesn't match `env.telegramWebhookSecret` exactly, or if `telegramWebhookSecret` isn't configured (fail closed, same posture as the admin passcode).

```ts
export async function POST(request: Request) {
  if (!env.telegramWebhookSecret ||
      request.headers.get("x-telegram-bot-api-secret-token") !== env.telegramWebhookSecret) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const update = await request.json().catch(() => null);
  const text: string | undefined = update?.message?.text;
  const chatId: string | undefined = update?.message?.chat?.id?.toString();
  if (!text || !chatId) return NextResponse.json({ ok: true }); // ignore anything not a /start message

  const match = text.match(/^\/start\s+(\S+)$/);
  if (!match) {
    await sendTelegramMessage(chatId, "This bot is used to link your Vantra account. Get your link from Settings in the Vantra dashboard.");
    return NextResponse.json({ ok: true });
  }

  const token = match[1];
  const user = await db.user.findFirst({
    where: { telegramLinkToken: token, telegramLinkTokenExpiresAt: { gt: new Date() } },
  });
  if (!user) {
    await sendTelegramMessage(chatId, "That link has expired. Generate a new one from Settings.");
    return NextResponse.json({ ok: true });
  }

  await db.user.update({
    where: { id: user.id },
    data: { telegramChatId: chatId, telegramLinkToken: null, telegramLinkTokenExpiresAt: null },
  });
  await sendTelegramMessage(chatId, "✅ Your Vantra account is now linked. You'll get alerts here based on your notification settings.");
  return NextResponse.json({ ok: true });
}
```

`app/api/settings/telegram/link/route.ts` — `POST`, auth-gated like every other settings route. Generates `crypto.randomUUID()`, stores it with a 15-minute expiry, returns `{ linkUrl: telegramLinkUrl(token) }` (503 if `telegramBotUsername` isn't configured). A second `DELETE` on the same route clears `telegramChatId` (disconnect).

**Settings UI** (`components/settings-form.tsx`): add a "Telegram" card — shows "Not connected" + a "Connect Telegram" button (calls the link route, opens `linkUrl` in a new tab) when `telegramChatId` is null; shows "Connected" + a "Disconnect" button otherwise. Sits naturally next to the existing Notifications card (`notifyDeviceOffline`/`notifyTicketReply` toggles) since that's exactly what this connection now enables.

## 5. Admin ops alerts (hook into existing routes, no new infra)

- **Payment flagged for review**: in `app/api/billing/manual/submit/route.ts`, in the existing "outside tolerance → flagged" branch, add: `void notifyAdmin(\`⚠️ Payment needs review: ${payment.method} for user ${user.email}, $${payment.amountUsd}. Check /admin101/payments.\`)`.
- **New user signup**: in `app/api/auth/signup/route.ts`, after the user row is created: `void notifyAdmin(\`👤 New signup: ${email}\`)`.
- Both are fire-and-forget (`void`, not `await`) — never let a Telegram hiccup slow down or fail the actual request.

## 6. VPS memory-pressure alert (new periodic check — first true polling job of this kind in Vantra)

New route `app/api/internal/telegram-vps-check/route.ts` — `POST`, bearer-token gated the same way `MSI_GENERATOR_SECRET` gates the MSI generator's own callback pattern (add `INTERNAL_CRON_SECRET` to `.env`, checked via a plain header compare). Logic:
```ts
const metrics = await getVpsMetrics(); // reuse — already built for the admin VPS tab
if (metrics.memUsedPercent >= 80) {
  const setting = await db.adminSetting.findUnique({ where: { id: "singleton" } });
  const debounceOk = !setting?.lastLowMemAlertAt || Date.now() - setting.lastLowMemAlertAt.getTime() > 60 * 60 * 1000;
  if (debounceOk) {
    await notifyAdmin(`🔴 VPS memory at ${metrics.memUsedPercent}% (${(metrics.memUsedMb/1024).toFixed(1)}/${(metrics.memTotalMb/1024).toFixed(1)} GB). Check /admin101/vps.`);
    await db.adminSetting.upsert({ where: { id: "singleton" }, update: { lastLowMemAlertAt: new Date() }, create: { id: "singleton", lastLowMemAlertAt: new Date() } });
  }
}
```
**A systemd timer must call this every 5–10 minutes** — `/etc/systemd/system/vantra-telegram-check.timer` + `.service` hitting `curl -H "Authorization: Bearer $INTERNAL_CRON_SECRET" http://127.0.0.1:3300/api/internal/telegram-vps-check`. **Cline should not create the systemd unit files** — that's VPS infra, done by Claude over SSH the same way every other systemd unit in this project has been, after this route exists and is deployed.

## 7. Customer self-serve alerts (device offline/online, ticket replies)

**Device offline/online** — same internal-bearer-token pattern, new route `app/api/internal/telegram-device-check/route.ts`, also driven by a systemd timer (every 5 min is reasonable):
```ts
const users = await db.user.findMany({
  where: { trmmClientId: { not: null }, telegramChatId: { not: null }, notifyDeviceOffline: true },
});
for (const user of users) {
  const agents = await listAgents(user.trmmClientId!);
  for (const agent of agents) {
    const prev = await db.deviceStatusSnapshot.findUnique({ where: { userId_agentId: { userId: user.id, agentId: agent.agent_id } } });
    const wasOnline = prev?.lastStatus === "online";
    const isOnline = agent.status === "online";
    if (prev && wasOnline !== isOnline) {
      await sendTelegramMessage(user.telegramChatId!,
        isOnline ? `✅ ${agent.hostname} is back online.` : `🔴 ${agent.hostname} went offline.`);
    }
    await db.deviceStatusSnapshot.upsert({
      where: { userId_agentId: { userId: user.id, agentId: agent.agent_id } },
      update: { lastStatus: agent.status },
      create: { userId: user.id, agentId: agent.agent_id, lastStatus: agent.status },
    });
  }
}
```
Note the `!prev` case (first time seeing this device) deliberately does **not** notify — otherwise every newly-enrolled device fires a spurious "back online" message on its very first poll.

**Ticket replies** — no polling needed, hook directly into the existing message-creation point in `app/api/tickets/[ticketId]/messages/route.ts`: after a new `TicketMessage` is created, if the replier is staff (`authorIsStaff: true`) and the ticket owner has `notifyTicketReply` + a linked `telegramChatId`, send them a message with the ticket subject and a link. (The reverse case — customer replies, notify staff — isn't asked for here; skip it unless requested.)

## Before this can go live

**Done already (Claude, over SSH)**: the bot exists (`@BrandappBot`), and `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` / `INTERNAL_CRON_SECRET` are already in `/opt/vantra/.env`.

**Still pending, not blocking Cline**:
1. `ADMIN_TELEGRAM_CHAT_ID` — waiting on the operator to message the bot once so its numeric chat ID can be read back via `getUpdates`.
2. **Registering the webhook** (`https://api.telegram.org/bot<token>/setWebhook` pointing at `https://vantra.instaweb.top/api/telegram/webhook`) — Claude does this over SSH/curl once Cline's webhook route (section 4 above) is written and deployed. Registering it before the route exists would just mean Telegram gets 404s, so this happens *after* deploy, not before.
3. **The two systemd timers** (VPS-check, device-check) — Claude installs these once the corresponding routes exist and are deployed, same pattern as every other systemd unit in this project.

None of the three above block Cline writing the code in this document — build all of it now; Claude handles the remaining wiring once it's deployed.

## Verification

1. Generate a link from Settings, click it, confirm the bot replies with the success message and `telegramChatId` is actually persisted.
2. Trigger a real flagged payment (an amount outside the ±5% tolerance) and confirm the admin chat receives it.
3. Sign up a brand-new test account and confirm the admin chat receives the new-signup alert.
4. Manually set `AdminSetting.lastLowMemAlertAt` to null and force a memory check while usage is genuinely high; confirm exactly one alert fires, then confirm a second immediate check within the debounce window does *not* re-alert.
5. Take a real test device offline and back online; confirm exactly one "went offline" and one "back online" message, not a message on every poll while it stays offline.
6. Reply to a customer's ticket as staff; confirm the customer's linked Telegram gets the notification, and confirm a customer without `notifyTicketReply` enabled does *not*.
